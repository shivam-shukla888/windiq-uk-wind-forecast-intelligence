from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from math import sqrt
from typing import Any
from urllib.parse import urlencode

import httpx

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
PILOT_MONTH = "2026-01"
UTC = timezone.utc

_DATA_CACHE: dict[str, tuple[list[dict[str, Any]], list[dict[str, Any]]]] = {}


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def validate_month(month: str) -> tuple[date, date]:
    if month != PILOT_MONTH:
        raise ValueError(f"This pilot supports {PILOT_MONTH} only")
    start = date.fromisoformat(f"{month}-01")
    return start, date(2026, 2, 1)


def select_vintages(forecasts: list[dict[str, Any]], cutoff: str = "day-ahead") -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    custom_deadline = None
    if cutoff != "day-ahead":
        try:
            custom_deadline = parse_utc(cutoff)
        except Exception as exc:
            raise ValueError(f"Invalid cutoff timestamp '{cutoff}': {exc}") from exc

    for row in forecasts:
        if row.get("startTime") is None or row.get("publishTime") is None:
            continue
        delivery = parse_utc(row["startTime"])
        published = parse_utc(row["publishTime"])
        deadline = delivery - timedelta(hours=24) if cutoff == "day-ahead" else custom_deadline
        if deadline is not None and published <= deadline:
            grouped[delivery.isoformat()].append({**row, "startTime": delivery.isoformat(), "publishTime": published.isoformat()})
    selected = []
    for delivery, rows in grouped.items():
        selected.append(max(rows, key=lambda r: parse_utc(r["publishTime"])))
    return sorted(selected, key=lambda r: r["startTime"])


def latest_actuals(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_start: dict[str, dict[str, Any]] = {}
    for row in rows:
        if str(row.get("fuelType", "")).upper() != "WIND" or row.get("generation") is None:
            continue
        start = parse_utc(row["startTime"]).isoformat()
        normalized = {**row, "startTime": start}
        current = by_start.get(start)
        if current is None or parse_utc(str(row.get("publishTime", "1970-01-01T00:00:00Z"))) >= parse_utc(str(current.get("publishTime", "1970-01-01T00:00:00Z"))):
            by_start[start] = normalized
    return by_start


def join_forecasts_actuals(forecasts: list[dict[str, Any]], actual_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    actuals = latest_actuals(actual_rows)
    joined = []
    for forecast in forecasts:
        actual = actuals.get(parse_utc(forecast["startTime"]).isoformat())
        actual_value = float(actual["generation"]) if actual else None
        forecast_value = float(forecast["generation"]) if forecast.get("generation") is not None else None
        error = forecast_value - actual_value if actual_value is not None and forecast_value is not None else None
        joined.append({
            "startTime": parse_utc(forecast["startTime"]).isoformat(),
            "settlementDate": forecast.get("settlementDate") or parse_utc(forecast["startTime"]).date().isoformat(),
            "settlementPeriod": forecast.get("settlementPeriod"),
            "forecastMW": forecast_value,
            "actualMW": actual_value,
            "publishTime": forecast.get("publishTime"),
            "errorMW": error,
            "absoluteErrorMW": abs(error) if error is not None else None,
            "actualPublishTime": actual.get("publishTime") if actual else None,
        })
    return joined


def calculate_metrics(rows: list[dict[str, Any]], expected_intervals: int) -> dict[str, Any]:
    matched = [r for r in rows if r.get("forecastMW") is not None and r.get("actualMW") is not None]
    errors = [float(r["forecastMW"]) - float(r["actualMW"]) for r in matched]
    nonzero = [(e, float(r["actualMW"])) for e, r in zip(errors, matched) if float(r["actualMW"]) != 0]
    n = len(errors)
    return {
        "intervalsExpected": expected_intervals,
        "intervalsForecasted": sum(r.get("forecastMW") is not None for r in rows),
        "intervalsMatched": n,
        "coveragePct": n / expected_intervals * 100 if expected_intervals else 0,
        "maeMW": sum(abs(e) for e in errors) / n if n else None,
        "rmseMW": sqrt(sum(e * e for e in errors) / n) if n else None,
        "mapePct": sum(abs(e / actual) for e, actual in nonzero) / len(nonzero) * 100 if nonzero else None,
        "mapeEligibleIntervals": len(nonzero),
        "zeroActualIntervals": n - len(nonzero),
        "signedBiasMW": sum(errors) / n if n else None,
        "forecastOnlyIntervals": sum(r.get("forecastMW") is not None and r.get("actualMW") is None for r in rows),
        "actualOnlyIntervals": sum(r.get("forecastMW") is None and r.get("actualMW") is not None for r in rows),
        "missingForecastIntervals": sum(r.get("forecastMW") is None for r in rows),
    }


async def _get_json(client: httpx.AsyncClient, path: str, params: dict[str, str]) -> Any:
    response = await client.get(f"{BASE_URL}/{path}", params=params)
    response.raise_for_status()
    payload = response.json()
    return payload.get("data", payload) if isinstance(payload, dict) else payload


async def fetch_month_data(month: str, force_refresh: bool = False) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    first, end = validate_month(month)
    if not force_refresh and month in _DATA_CACHE:
        return _DATA_CACHE[month]

    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0), headers={"User-Agent": "WindIQ-pilot/1.0"}) as client:
        actual_tasks = []
        day = first
        while day < end:
            day_end = day + timedelta(days=1)
            actual_tasks.append(_get_json(client, "datasets/FUELHH", {
                "settlementDateFrom": day.isoformat(), "settlementDateTo": day.isoformat(), "format": "json"
            }))
            day = day_end
        actual_batches = await _gather_limited(actual_tasks, 5)
        actuals = [row for batch in actual_batches for row in batch if str(row.get("fuelType", "")).upper() == "WIND"]
        forecast_tasks = []
        window_start = datetime(2025, 12, 30, tzinfo=UTC)
        forecast_end = datetime(2026, 2, 1, tzinfo=UTC)
        while window_start < forecast_end:
            window_end = min(window_start + timedelta(days=7), forecast_end)
            forecast_tasks.append(_get_json(client, "datasets/WINDFOR", {
                "publishDateTimeFrom": window_start.isoformat().replace("+00:00", "Z"),
                "publishDateTimeTo": window_end.isoformat().replace("+00:00", "Z"), "format": "json"
            }))
            window_start = window_end
        forecast_batches = await _gather_limited(forecast_tasks, 5)
        forecasts = []
        seen_forecasts: set[tuple[str, str, str]] = set()
        for batch in forecast_batches:
            for row in batch:
                key = (str(row.get("publishTime")), str(row.get("startTime")), str(row.get("generation")))
                if key not in seen_forecasts:
                    forecasts.append(row)
                    seen_forecasts.add(key)

    _DATA_CACHE[month] = (forecasts, actuals)
    return forecasts, actuals


async def _gather_limited(coroutines: list[Any], limit: int) -> list[Any]:
    import asyncio
    semaphore = asyncio.Semaphore(limit)
    async def run(coro: Any) -> Any:
        async with semaphore:
            return await coro
    return await asyncio.gather(*(run(c) for c in coroutines))


def build_analysis(month: str, cutoff: str, forecasts: list[dict[str, Any]], actuals: list[dict[str, Any]]) -> dict[str, Any]:
    first, end = validate_month(month)
    all_forecasts = [r for r in forecasts if r.get("startTime") and first <= parse_utc(r["startTime"]).date() < end]
    chosen = select_vintages(all_forecasts, cutoff)
    selected_by_start = {parse_utc(r["startTime"]).isoformat(): r for r in chosen}
    actual_by_start = latest_actuals(actuals)
    expected = 31 * 48
    joined: list[dict[str, Any]] = []
    cursor = datetime(2026, 1, 1, tzinfo=UTC)
    for _ in range(expected):
        start = cursor.isoformat()
        forecast = selected_by_start.get(start)
        actual = actual_by_start.get(start)
        f = {
            **(forecast or {}),
            "startTime": start,
            "settlementDate": cursor.date().isoformat(),
            "settlementPeriod": cursor.hour * 2 + cursor.minute // 30 + 1,
        }
        f.setdefault("generation", None)
        f.setdefault("publishTime", None)
        joined.extend(join_forecasts_actuals([f], [actual] if actual else []))
        cursor += timedelta(minutes=30)
    metrics = calculate_metrics(joined, expected)
    actual_index = latest_actuals(actuals)
    actual_dates = {k for k in actual_index if first <= parse_utc(k).date() < end}
    metrics["actualIntervalsAvailable"] = len(actual_dates)
    metrics["actualCoveragePct"] = len(actual_dates) / expected * 100
    return {
        "month": month,
        "timezone": "UTC",
        "cutoff": cutoff,
        "records": joined,
        "metrics": metrics,
        "quality": {
            "forecastSourceRows": len(all_forecasts),
            "actualWindSourceRows": sum(str(r.get("fuelType", "")).upper() == "WIND" for r in actuals),
            "uniqueActualIntervals": len(actual_dates),
            "selectedForecastIntervals": len(chosen),
            "duplicateActualRevisionsCollapsed": max(0, sum(str(r.get("fuelType", "")).upper() == "WIND" for r in actuals) - len(actual_index)),
            "forecastVintageRowsNotSelected": len(all_forecasts) - len(chosen),
            "apiSources": ["Elexon FUELHH", "Elexon WINDFOR"],
        },
    }

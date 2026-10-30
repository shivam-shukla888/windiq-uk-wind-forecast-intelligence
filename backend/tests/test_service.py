from datetime import datetime, timezone
import pytest

from app.service import (
    build_analysis,
    calculate_metrics,
    join_forecasts_actuals,
    parse_utc,
    select_vintages,
    validate_month,
)


def test_vintage_selection_uses_latest_published_before_day_ahead_cutoff():
    forecasts = [
        {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T11:59:59Z", "generation": 100},
        {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T12:00:00Z", "generation": 110},
        {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T12:00:01Z", "generation": 120},
    ]
    chosen = select_vintages(forecasts)
    assert len(chosen) == 1
    assert chosen[0]["generation"] == 110


def test_vintage_selection_supports_custom_utc_cutoff():
    forecasts = [
        {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2025-12-31T11:59:59Z", "generation": 90},
        {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2025-12-31T12:00:00Z", "generation": 95},
        {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2025-12-31T12:00:01Z", "generation": 100},
    ]
    chosen = select_vintages(forecasts, cutoff="2025-12-31T12:00:00Z")
    assert len(chosen) == 1
    assert chosen[0]["generation"] == 95


def test_vintage_selection_invalid_cutoff_raises_value_error():
    forecasts = [{"startTime": "2026-01-02T12:00:00Z", "publishTime": "2025-12-31T12:00:00Z", "generation": 95}]
    with pytest.raises(ValueError, match="Invalid cutoff timestamp"):
        select_vintages(forecasts, cutoff="not-a-date")


def test_validate_month_pilot_constraint():
    start, end = validate_month("2026-01")
    assert start.isoformat() == "2026-01-01"
    assert end.isoformat() == "2026-02-01"
    with pytest.raises(ValueError, match="pilot supports 2026-01 only"):
        validate_month("2026-02")


def test_timestamp_naive_is_interpreted_as_utc_and_offsets_normalize():
    assert parse_utc("2026-01-01T05:30:00+05:30") == datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    assert parse_utc("2026-01-01T00:00:00") == datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)


def test_join_by_normalized_start_time_and_latest_actual_revision():
    forecasts = [{"startTime": "2026-01-01T05:30:00+05:30", "publishTime": "2025-12-31T00:00:00Z", "generation": 20}]
    actuals = [
        {"startTime": "2026-01-01T00:00:00Z", "publishTime": "2026-01-02T00:00:00Z", "fuelType": "WIND", "generation": 18},
        {"startTime": "2026-01-01T00:00:00Z", "publishTime": "2026-01-03T00:00:00Z", "fuelType": "WIND", "generation": 19},
        {"startTime": "2026-01-01T00:00:00Z", "publishTime": "2026-01-04T00:00:00Z", "fuelType": "CCGT", "generation": 30},
    ]
    result = join_forecasts_actuals(forecasts, actuals)
    assert result[0]["actualMW"] == 19
    assert result[0]["errorMW"] == 1


def test_metrics_zero_actual_handling_signed_bias_and_coverage():
    rows = [
        {"forecastMW": 12, "actualMW": 10},
        {"forecastMW": 6, "actualMW": 0},
        {"forecastMW": 7, "actualMW": 10},
        {"forecastMW": 1, "actualMW": None},
    ]
    result = calculate_metrics(rows, 4)
    assert result["intervalsMatched"] == 3
    assert result["maeMW"] == 11 / 3
    assert result["rmseMW"] == ((49 / 3) ** 0.5)
    assert result["mapePct"] == 25
    assert result["mapeEligibleIntervals"] == 2
    assert result["zeroActualIntervals"] == 1
    assert result["signedBiasMW"] == 5 / 3
    assert result["coveragePct"] == 75


def test_build_analysis_does_not_interpolate_missing_forecasts():
    forecasts = [
        {"startTime": "2026-01-01T00:00:00Z", "publishTime": "2025-12-31T00:00:00Z", "generation": 1000},
    ]
    actuals = [
        {"startTime": "2026-01-01T00:00:00Z", "publishTime": "2026-01-01T00:30:00Z", "fuelType": "WIND", "generation": 950},
        {"startTime": "2026-01-01T00:30:00Z", "publishTime": "2026-01-01T01:00:00Z", "fuelType": "WIND", "generation": 920},
    ]
    result = build_analysis("2026-01", "day-ahead", forecasts, actuals)
    assert len(result["records"]) == 31 * 48  # All 1,488 expected intervals are indexed
    r0 = result["records"][0]  # 00:00
    r1 = result["records"][1]  # 00:30
    assert r0["forecastMW"] == 1000
    assert r0["actualMW"] == 950
    assert r0["errorMW"] == 50
    # Crucially: r1 has actual, but NO forecast. It must NOT be interpolated!
    assert r1["forecastMW"] is None
    assert r1["actualMW"] == 920
    assert r1["errorMW"] is None

from datetime import datetime, timezone

from app.service import calculate_metrics, join_forecasts_actuals, parse_utc, select_vintages


def test_vintage_selection_uses_latest_published_before_day_ahead_cutoff():
    forecasts = [
        {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T11:59:59Z", "generation": 100},
        {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T12:00:00Z", "generation": 110},
        {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T12:00:01Z", "generation": 120},
    ]
    chosen = select_vintages(forecasts)
    assert len(chosen) == 1
    assert chosen[0]["generation"] == 110


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

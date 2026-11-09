"""Unit tests for agent/price_check.py (pure functions, pytest-safe).

Run: py -m pytest tests/test_price_check.py -v
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agent.price_check import (  # noqa: E402
    evaluate_leg,
    parse_money,
    parse_rates_response,
)

GEMINI_BC = (
    "ACCOM: BC\nTRIP: CEB-TAG\nFARE: 1,450.00\nDISCOUNT: - 0.00\n"
    "TERMINAL_FEE: 0.00\nTOTAL_DUE: 1,450.00"
)


def test_parse_money_formats():
    assert parse_money("1,450.00") == 1450.0
    assert parse_money("912.00") == 912.0
    assert parse_money("- 0.00") == 0.0
    assert parse_money("-0.00") == 0.0
    assert parse_money("") is None
    assert parse_money("n/a") is None


def test_parse_money_ocr_separator_variants():
    # Nov 9, 2026: Gemini printed the thousands comma as a period on
    # BW6070904 (1.450.00 → parsed 1.45) and BW6071156 (1.080.00 → 1.08).
    assert parse_money("1.450.00") == 1450.0
    assert parse_money("1.080.00") == 1080.0
    assert parse_money("1.450,00") == 1450.0
    assert parse_money("1450.00") == 1450.0
    assert parse_money("1 450.00") == 1450.0
    assert parse_money("1080") == 1080.0
    assert parse_money("1,450") == 1450.0
    assert parse_money("1.450") == 1450.0
    assert parse_money("PHP 1,450.00") == 1450.0
    assert parse_money("1.45") == 1.45
    assert parse_money("12,345,678.90") == 12345678.9
    assert parse_money("- 50.00") == -50.0


def test_parse_rates_response_period_as_thousands_separator():
    raw = (
        "ACCOM: TC\nTRIP: DUM-TAG\nFARE: 1.080.00\nDISCOUNT: - 0.00\n"
        "TERMINAL_FEE: 0.00\nTOTAL_DUE: 1.080.00"
    )
    r = parse_rates_response(raw)
    assert r["total_due"] == 1080.0
    assert evaluate_leg(r["total_due"], 1026 / 0.95, 0.0, is_last_leg=True)[0] == "match"


def test_parse_rates_response_vm_sample():
    r = parse_rates_response(GEMINI_BC)
    assert r["accom"] == "BC"
    assert r["trip"] == "CEB-TAG"
    assert r["fare"] == 1450.0
    assert r["total_due"] == 1450.0
    assert r["discount"] == 0.0


def test_parse_rates_response_blank_rows():
    r = parse_rates_response("ACCOM: \nTRIP: \nFARE: \nDISCOUNT: \nTERMINAL_FEE: \nTOTAL_DUE: ")
    assert r["total_due"] is None
    assert r["accom"] == ""


def test_one_way_match_business():
    # Bookaway 1377.5 PHP -> expected PRIME 1450.00
    verdict, _ = evaluate_leg(1450.0, 1450.0, 0.0, is_last_leg=True)
    assert verdict == "match"


def test_one_way_match_tourist_with_tolerance():
    # Bookaway 912 / 0.95 = 960.0000000000001 in float land
    verdict, _ = evaluate_leg(960.0, 912 / 0.95, 0.0, is_last_leg=True)
    assert verdict == "match"


def test_one_way_mismatch_stale_bookaway_cost():
    # Old booking at 836 PHP (expected 880.00) while PRIME charges 960.00
    verdict, detail = evaluate_leg(960.0, 836 / 0.95, 0.0, is_last_leg=True)
    assert verdict == "mismatch"
    assert "+80.00" in detail


def test_round_trip_total_covers_both_legs():
    # Two items of 912 -> 1824 / 0.95 = 1920.00 shown in one issue
    verdict, _ = evaluate_leg(1920.0, 1824 / 0.95, 0.0, is_last_leg=True)
    assert verdict == "match"


def test_connecting_leg1_below_expected_then_leg2_sum():
    expected = 1824 / 0.95  # 1920.00 for CEB-SIQ via TAG
    v1, _ = evaluate_leg(960.0, expected, 0.0, is_last_leg=False)
    assert v1 == "match"
    v2, _ = evaluate_leg(960.0, expected, 960.0, is_last_leg=True)
    assert v2 == "match"


def test_connecting_leg1_already_at_expected_is_mismatch():
    expected = 1824 / 0.95
    v1, detail = evaluate_leg(1920.0, expected, 0.0, is_last_leg=False)
    assert v1 == "mismatch"
    assert "legs still to issue" in detail


def test_connecting_leg2_sum_mismatch():
    expected = 1824 / 0.95
    v2, detail = evaluate_leg(1000.0, expected, 960.0, is_last_leg=True)
    assert v2 == "mismatch"
    assert "1,960.00" in detail


def test_unreadable_and_zero():
    assert evaluate_leg(None, 960.0, 0.0, True)[0] == "unreadable"
    assert evaluate_leg(0.0, 960.0, 0.0, True)[0] == "mismatch"

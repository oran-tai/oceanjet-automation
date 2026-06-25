"""Unit tests for date and time conversion utilities."""

import pytest
from agent.date_utils import (
    bookaway_date_to_prime,
    match_departure_time,
    find_connecting_departure,
    normalize_prime_date_field,
    grid_datetime_to_mmddyy,
)


class TestBookawayDateToPrime:
    def test_basic_date(self):
        assert bookaway_date_to_prime("Fri, Apr 18th 2025") == "041825"

    def test_first_day(self):
        assert bookaway_date_to_prime("Wed, Jan 1st 2025") == "010125"

    def test_second_day(self):
        assert bookaway_date_to_prime("Thu, Jan 2nd 2025") == "010225"

    def test_third_day(self):
        assert bookaway_date_to_prime("Fri, Jan 3rd 2025") == "010325"

    def test_double_digit_day(self):
        assert bookaway_date_to_prime("Mon, Dec 22nd 2025") == "122225"

    def test_single_digit_month(self):
        assert bookaway_date_to_prime("Tue, Mar 5th 2026") == "030526"

    def test_leap_year(self):
        assert bookaway_date_to_prime("Sat, Feb 29th 2028") == "022928"

    def test_eleventh(self):
        assert bookaway_date_to_prime("Tue, Nov 11th 2025") == "111125"

    def test_twelfth(self):
        assert bookaway_date_to_prime("Wed, Nov 12th 2025") == "111225"

    def test_thirteenth(self):
        assert bookaway_date_to_prime("Thu, Nov 13th 2025") == "111325"

    def test_twenty_first(self):
        assert bookaway_date_to_prime("Fri, Mar 21st 2025") == "032125"


class TestMatchDepartureTime:
    GRID_TIMES = [
        "3/27/2026 7:30:00 AM",
        "3/27/2026 1:00:00 PM",
        "3/27/2026 3:20:00 PM",
    ]

    def test_exact_match_morning(self):
        assert match_departure_time("7:30 AM", self.GRID_TIMES) == 0

    def test_exact_match_afternoon(self):
        assert match_departure_time("1:00 PM", self.GRID_TIMES) == 1

    def test_exact_match_with_seconds(self):
        assert match_departure_time("3:20 PM", self.GRID_TIMES) == 2

    def test_no_match(self):
        assert match_departure_time("5:00 PM", self.GRID_TIMES) is None

    def test_leading_zero(self):
        assert match_departure_time("07:30 AM", self.GRID_TIMES) == 0

    def test_noon(self):
        grid = ["3/27/2026 12:00:00 PM"]
        assert match_departure_time("12:00 PM", grid) == 0

    def test_midnight(self):
        grid = ["3/27/2026 12:00:00 AM"]
        assert match_departure_time("12:00 AM", grid) == 0

    def test_empty_grid(self):
        assert match_departure_time("1:00 PM", []) is None

    def test_invalid_target_time(self):
        assert match_departure_time("not a time", self.GRID_TIMES) is None

    def test_time_only_grid_format(self):
        grid = ["7:30:00 AM", "1:00:00 PM"]
        assert match_departure_time("1:00 PM", grid) == 1


class TestNormalizePrimeDateField:
    def test_strips_slashes(self):
        assert normalize_prime_date_field("06/25/26") == "062526"

    def test_handles_empty(self):
        assert normalize_prime_date_field("") == ""
        assert normalize_prime_date_field(None) == ""

    def test_strips_padding_and_text(self):
        assert normalize_prime_date_field("  06/25/26  ") == "062526"


class TestGridDatetimeToMmddyy:
    def test_full_datetime(self):
        assert grid_datetime_to_mmddyy("6/25/2026 1:00:00 PM") == "062526"

    def test_two_digit_year(self):
        assert grid_datetime_to_mmddyy("6/25/26 1:00:00 PM") == "062526"

    def test_unparseable_returns_none(self):
        # Never false-positive a guard on an unexpected OCR format
        assert grid_datetime_to_mmddyy("garbage") is None
        assert grid_datetime_to_mmddyy("") is None


class TestStaleDateRegression:
    """Regression for BW5276308: a prior 13-Jul booking left PRIME's date field
    on 07/13, this 25-Jun booking's date write didn't land, and time-only
    matching booked the wrong day. The voyage-date guard must catch it."""

    def test_time_matches_but_date_is_wrong(self):
        requested_date = "Thu, Jun 25th 2026"
        # Grid is filtered to the STALE date (13 Jul) still in PRIME's field
        stale_grid = [
            "7/13/2026 8:00:00 AM",
            "7/13/2026 1:00:00 PM",  # same 1 PM time as the real booking
        ]
        # Time-only matching is happy — this is the latent bug
        assert match_departure_time("1:00 PM", stale_grid) == 1
        # But the selected row's date does NOT equal the requested date
        want = bookaway_date_to_prime(requested_date)        # "062526"
        got = grid_datetime_to_mmddyy(stale_grid[1])         # "071326"
        assert got is not None and got != want               # guard fires

    def test_correct_date_passes_guard(self):
        requested_date = "Thu, Jun 25th 2026"
        good_grid = ["6/25/2026 1:00:00 PM"]
        want = bookaway_date_to_prime(requested_date)
        got = grid_datetime_to_mmddyy(good_grid[0])
        assert got == want                                   # guard stays silent


class TestFindConnectingDeparture:
    """Test dynamic connecting leg 2 departure selection.

    Rule: pick the closest departure within 20-120 min after arrival.
    """

    GRID_TIMES = [
        "3/27/2026 7:30:00 AM",
        "3/27/2026 9:00:00 AM",
        "3/27/2026 10:30:00 AM",
        "3/27/2026 1:00:00 PM",
        "3/27/2026 3:20:00 PM",
    ]

    def test_picks_closest_within_window(self):
        # Arrive 8:30 AM → window 8:50-10:30 → 9:00 AM (row 1) is closest
        assert find_connecting_departure("3/27/2026 8:30:00 AM", self.GRID_TIMES) == 1

    def test_picks_closest_not_first(self):
        # Arrive 8:00 AM → window 8:20-10:00 → 9:00 AM (row 1) is closest
        assert find_connecting_departure("3/27/2026 8:00:00 AM", self.GRID_TIMES) == 1

    def test_skips_too_soon(self):
        # Arrive 8:50 AM → window 9:10-10:50 → 9:00 is too soon, 10:30 AM (row 2) is closest
        assert find_connecting_departure("3/27/2026 8:50:00 AM", self.GRID_TIMES) == 2

    def test_no_match_too_late(self):
        # Arrive 1:30 PM → window 1:50-3:30 → 3:20 PM (row 4) is in window
        assert find_connecting_departure("3/27/2026 1:30:00 PM", self.GRID_TIMES) == 4

    def test_no_match_all_too_far(self):
        # Arrive 1:00 AM → window 1:20-3:00 AM → no departures in that range
        assert find_connecting_departure("3/27/2026 1:00:00 AM", self.GRID_TIMES) is None

    def test_no_match_all_too_soon(self):
        # Arrive 3:15 PM → window 3:35-5:15 PM → nothing available
        assert find_connecting_departure("3/27/2026 3:15:00 PM", self.GRID_TIMES) is None

    def test_exactly_at_min_boundary(self):
        # Arrive 8:40 AM → window 9:00-10:40 → 9:00 AM (row 1) is exactly at min boundary
        assert find_connecting_departure("3/27/2026 8:40:00 AM", self.GRID_TIMES) == 1

    def test_exactly_at_max_boundary(self):
        # Arrive 7:00 AM → window 7:20-9:00 → 7:30 AM (row 0) and 9:00 AM (row 1) both in window
        # 7:30 AM is closer to min_depart (7:20), so row 0
        assert find_connecting_departure("3/27/2026 7:00:00 AM", self.GRID_TIMES) == 0

    def test_empty_grid(self):
        assert find_connecting_departure("3/27/2026 8:30:00 AM", []) is None

    def test_invalid_arrival_time(self):
        assert find_connecting_departure("not a time", self.GRID_TIMES) is None

    def test_time_only_format(self):
        grid = ["9:00:00 AM", "10:30:00 AM"]
        # Arrive 8:30 AM → window 8:50-10:30 → 9:00 AM (row 0)
        assert find_connecting_departure("8:30:00 AM", grid) == 0

    def test_custom_wait_times(self):
        # Arrive 8:30 AM with 60-180 min window → 10:30 AM (row 2) and 1:00 PM (row 3)
        # 10:30 is closest to min_depart (9:30)
        result = find_connecting_departure(
            "3/27/2026 8:30:00 AM", self.GRID_TIMES,
            min_wait_minutes=60, max_wait_minutes=180,
        )
        assert result == 2

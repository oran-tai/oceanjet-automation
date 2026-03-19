"""Unit tests for date and time conversion utilities."""

import pytest
from agent.date_utils import bookaway_date_to_prime, match_departure_time


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

"""Date and time conversion utilities for Bookaway -> PRIME format."""

import re
from datetime import datetime


def bookaway_date_to_prime(date_str: str) -> str:
    """Convert Bookaway date to PRIME masked edit digit string.

    Input:  "Fri, Apr 18th 2025"
    Output: "041825"

    PRIME's date field is a Delphi masked edit (_M/DD/YY).
    The mask auto-inserts slashes — we only type the digits.
    Format: MMDDYY (zero-padded month and day, 2-digit year).
    """
    # Remove weekday prefix: "Fri, Apr 18th 2025" -> "Apr 18th 2025"
    cleaned = re.sub(r"^[A-Za-z]+,\s*", "", date_str.strip())
    # Remove ordinal suffix: "Apr 18th 2025" -> "Apr 18 2025"
    cleaned = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", cleaned)
    # Parse the date
    dt = datetime.strptime(cleaned.strip(), "%b %d %Y")
    # Format as MMDDYY digits only (mask inserts the slashes)
    return dt.strftime("%m%d%y")


def match_departure_time(target_time: str, grid_times: list[str]) -> int | None:
    """Find the grid row matching the target departure time.

    Args:
        target_time: Time from Bookaway, e.g. "1:00 PM"
        grid_times: Datetime strings from Claude Vision, e.g.
                    ["3/27/2026 7:30:00 AM", "3/27/2026 1:00:00 PM"]

    Returns:
        0-based row index, or None if no match found.
    """
    # Parse target time (handle both "1:00 PM" and "01:00 PM")
    target_time = target_time.strip()
    for fmt in ("%I:%M %p", "%I:%M:%S %p"):
        try:
            target_dt = datetime.strptime(target_time, fmt)
            break
        except ValueError:
            continue
    else:
        return None

    target_hour = target_dt.hour
    target_minute = target_dt.minute

    for i, grid_time in enumerate(grid_times):
        grid_time = grid_time.strip()
        # Try parsing full datetime format from grid
        for fmt in (
            "%m/%d/%Y %I:%M:%S %p",
            "%m/%d/%Y %I:%M %p",
            "%I:%M:%S %p",
            "%I:%M %p",
        ):
            try:
                grid_dt = datetime.strptime(grid_time, fmt)
                if grid_dt.hour == target_hour and grid_dt.minute == target_minute:
                    return i
                break
            except ValueError:
                continue

    return None


def find_connecting_departure(
    arrival_time: str,
    grid_times: list[str],
    min_wait_minutes: int = 20,
    max_wait_minutes: int = 120,
) -> int | None:
    """Find the best connecting leg 2 departure from the voyage grid.

    Picks the closest departure where:
        arrival_time + min_wait <= departure <= arrival_time + max_wait

    Args:
        arrival_time: Leg 1 arrival time, e.g. "3/27/2026 3:00:00 PM" or "3:00 PM"
        grid_times: Departure datetime strings from Gemini Vision
        min_wait_minutes: Minimum connection time (default 20 min)
        max_wait_minutes: Maximum connection time (default 120 min)

    Returns:
        0-based row index of the best match, or None if no valid connection.
    """
    from datetime import timedelta

    # Parse arrival time
    arrival_dt = None
    for fmt in (
        "%m/%d/%Y %I:%M:%S %p",
        "%m/%d/%Y %I:%M %p",
        "%I:%M:%S %p",
        "%I:%M %p",
    ):
        try:
            arrival_dt = datetime.strptime(arrival_time.strip(), fmt)
            break
        except ValueError:
            continue

    if arrival_dt is None:
        return None

    min_depart = arrival_dt + timedelta(minutes=min_wait_minutes)
    max_depart = arrival_dt + timedelta(minutes=max_wait_minutes)

    best_idx = None
    best_diff = None

    for i, grid_time in enumerate(grid_times):
        grid_time = grid_time.strip()
        grid_dt = None
        for fmt in (
            "%m/%d/%Y %I:%M:%S %p",
            "%m/%d/%Y %I:%M %p",
            "%I:%M:%S %p",
            "%I:%M %p",
        ):
            try:
                grid_dt = datetime.strptime(grid_time, fmt)
                break
            except ValueError:
                continue

        if grid_dt is None:
            continue

        # For time-only formats, use same date as arrival for comparison
        if grid_dt.year == 1900:
            grid_dt = grid_dt.replace(
                year=arrival_dt.year, month=arrival_dt.month, day=arrival_dt.day
            )

        if min_depart <= grid_dt <= max_depart:
            diff = abs((grid_dt - min_depart).total_seconds())
            if best_diff is None or diff < best_diff:
                best_diff = diff
                best_idx = i

    return best_idx

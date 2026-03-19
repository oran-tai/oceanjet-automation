"""Date and time conversion utilities for Bookaway -> PRIME format."""

import re
from datetime import datetime


def bookaway_date_to_prime(date_str: str) -> str:
    """Convert Bookaway date to PRIME date format.

    Input:  "Fri, Apr 18th 2025"
    Output: "4/18/25"

    Steps:
    1. Strip weekday prefix (e.g., "Fri, ")
    2. Strip ordinal suffix (st/nd/rd/th)
    3. Parse and format as M/D/YY
    """
    # Remove weekday prefix: "Fri, Apr 18th 2025" -> "Apr 18th 2025"
    cleaned = re.sub(r"^[A-Za-z]+,\s*", "", date_str.strip())
    # Remove ordinal suffix: "Apr 18th 2025" -> "Apr 18 2025"
    cleaned = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", cleaned)
    # Parse the date
    dt = datetime.strptime(cleaned.strip(), "%b %d %Y")
    # Format as M/D/YY (no leading zeros)
    return f"{dt.month}/{dt.day}/{dt.strftime('%y')}"


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

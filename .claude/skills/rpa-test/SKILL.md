---
name: rpa-test
description: Generate standalone test scripts for OceanJet PRIME RPA agent error scenarios. Use this skill whenever the user wants to create, write, or add an RPA error test, test a specific TicketErrorCode, add a test case for the PRIME driver, or mentions testing error handling in the RPA agent. Also trigger when the user asks about which error codes have tests or need tests.
---

# RPA Error Test Generator

Generate standalone Python test scripts that verify the RPA agent correctly detects and recovers from specific PRIME error scenarios.

## Why standalone scripts (not pytest)

pytest causes Windows fatal exception `0x80040155` when combined with pywinauto's UIA backend — a COM threading conflict that crashes the entire process. Every PRIME integration test must be a standalone script with `if __name__ == "__main__":`. pytest is only safe for pure unit tests that never touch pywinauto (like `test_date_utils.py`).

## Before writing a test

1. Read `rpa-agent/agent/error_codes.py` to see all available `TicketErrorCode` values
2. Read `rpa-agent/agent/prime_driver.py` to understand how the target error code is raised — what input triggers it
3. Check `rpa-agent/tests/` to see which error tests already exist (pattern: `test_error_<code>.py`)
4. Read `rpa-agent/tests/test_error_station_not_found.py` as the reference template

## File location

Each test goes in: `rpa-agent/tests/test_error_<error_code_lowercase>.py`

One file per error scenario. The run command from `C:\rpa-agent` is always:
```
py tests/test_error_<name>.py
```

## Test file structure

Follow this exact structure — every section matters:

```python
"""Error test: <ERROR_CODE>

Verifies that the RPA raises <ERROR_CODE> when <describe trigger condition>,
then recovers and successfully fills a valid booking.

Run on the VM with PRIME open on Issue New Ticket:
    py tests/test_error_<name>.py
"""

import logging
import os
import sys

# This path fix is essential — without it, `from agent.xxx` fails when
# running the script from any directory other than rpa-agent/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-error")

# Define test bookings as module-level dicts (before main)
INVALID_BOOKING = {
    # ... booking dict that triggers the error
}

VALID_BOOKING = {
    # ... CEB->TAG one-way booking for recovery verification
}


def main():
    # Imports go HERE inside main(), not at module level.
    # Importing pywinauto at module level before the sys.path fix
    # can cause import failures.
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import TicketErrorCode

    logger.info("=" * 60)
    logger.info("TEST: <ERROR_CODE> error + recovery")
    logger.info("=" * 60)

    driver = PrimeDriver()

    # 1. Invalid booking should return the target error
    logger.info("")
    logger.info("--- Booking 1: <describe why it fails> (should fail) ---")
    result = driver.fill_booking(INVALID_BOOKING)
    if not result["success"] and result.get("errorCode") == TicketErrorCode.<ERROR_CODE>.value:
        logger.info(f"PASS: Got expected error: {result['errorCode']} - {result.get('error')}")
    elif result["success"]:
        logger.error("FAIL: Expected <ERROR_CODE> but fill_booking succeeded")
        sys.exit(1)
    else:
        logger.error(f"FAIL: Expected <ERROR_CODE>, got {result.get('errorCode')}")
        sys.exit(1)

    # 2. Reset form for recovery test
    logger.info("")
    logger.info("--- Resetting form for next booking ---")
    driver.click_refresh()

    # 3. Valid booking should succeed (proves the agent recovered)
    logger.info("")
    logger.info("--- Booking 2: valid CEB->TAG (should succeed) ---")
    result = driver.fill_booking(VALID_BOOKING)
    if result["success"]:
        logger.info("PASS: Valid booking filled successfully - recovery confirmed")
    else:
        logger.error(f"FAIL: Valid booking failed after recovery: {result.get('error')}")
        sys.exit(1)

    logger.info("")
    logger.info("=" * 60)
    logger.info("TEST PASSED")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
```

## The valid recovery booking

The recovery booking is always CEB→TAG one-way — this is a known working route that reliably has voyages available:

```python
VALID_BOOKING = {
    "bookingId": "err-<code>-002",
    "reference": "ERR-<CODE>-002",
    "bookingType": "one-way",
    "passengers": [
        {
            "firstName": "Juan",
            "lastName": "Dela Cruz",
            "age": "30",
            "gender": "Male",
        }
    ],
    "departureLeg": {
        "origin": "CEB",
        "destination": "TAG",
        "date": "Fri, Mar 27th 2026",
        "time": "6:00 AM",
        "accommodation": "TC",
    },
    "contactInfo": "test@example.com",
}
```

## Date rules

All test dates must be in the future. Use **March 2026 or later**. The booking date format follows Bookaway style: `"Fri, Mar 27th 2026"`.

## Crafting the invalid booking

The invalid booking must trigger the specific error code. Think about what input causes `prime_driver.py` to raise `PrimeError` with that code:

| Error Code | What triggers it | Invalid booking approach |
|---|---|---|
| `STATION_NOT_FOUND` | Origin/destination not in PRIME dropdown | Use fake station code like `"ABC"` |
| `TRIP_NOT_FOUND` | Voyage Schedule grid is empty | Use a date/route with no voyages |
| `VOYAGE_TIME_MISMATCH` | No voyage matches the requested time | Use a time that doesn't exist like `"11:59 PM"` |
| `ACCOMMODATION_UNAVAILABLE` | Accommodation code not in dropdown | Use fake code like `"XX"` |
| `PASSENGER_VALIDATION_ERROR` | Invalid passenger data | Missing required fields |
| `DUPLICATE_PASSENGER` | Same passenger booked twice | Duplicate name/details |
| `DATE_BLACKOUT` | Booking on a blocked date | Use a known blackout date |
| `PRIME_TIMEOUT` | PRIME dialog doesn't appear in time | Hard to trigger intentionally |
| `PRIME_CRASH` | PRIME process dies | Hard to trigger intentionally |

For error codes that are hard to trigger via booking data alone (system-level errors like `PRIME_TIMEOUT`, `PRIME_CRASH`, `SESSION_EXPIRED`, `RPA_INTERNAL_ERROR`), note this to the user — these are better tested via mocking or manual scenarios rather than automated scripts.

## Key rules (and why they matter)

- **Use `sys.exit(1)` for failures, not `assert`** — these are standalone scripts, not pytest tests. Assert would throw an unhandled exception with a confusing traceback instead of a clean "FAIL" message.
- **Imports inside `main()`** — the `sys.path.insert` at module level must execute before any `from agent.xxx` import. If imports are at module level, Python processes them before the path fix runs.
- **Always test recovery** — the agent must handle errors gracefully and continue working. A test that only checks the error without verifying recovery is incomplete.
- **Sequential booking IDs** — use `err-<code>-001` for invalid, `err-<code>-002` for valid. Keeps logs easy to follow.

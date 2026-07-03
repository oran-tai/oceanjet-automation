"""Error test: UNEXPECTED_POPUP (+ the no-popup PRIME_VALIDATION_ERROR branch)

Verifies the _type_date_field blocker check: when the departure date fails
3 fill-and-read-back attempts, the driver clicks Refresh, classifies the
screen via Gemini, and raises
  - UNEXPECTED_POPUP        if a popup / print preview is blocking the form
  - PRIME_VALIDATION_ERROR  if the screen is clean (no blocker found)

The 3 failed read-backs are simulated by monkeypatching _read_date_field to
return a stale value — everything else (Refresh click, screenshot, Gemini
classification, error dispatch) runs for real against live PRIME.

NEITHER mode clicks Issue — no ticket is ever created.

Run on the VM with PRIME open on Issue New Ticket, logged in:

  py tests/test_error_unexpected_popup.py none
        Screen must be CLEAN (no popup). Expects PRIME_VALIDATION_ERROR with
        'no blocking popup was found', then proves recovery by re-running a
        real date fill that must verify successfully.

  py tests/test_error_unexpected_popup.py popup
        MANUAL SETUP FIRST: make a modal popup block the form — easiest is
        clicking Issue on an empty form so PRIME shows a validation dialog
        (or reproduce the 'Session ID is missing' popup by breaking the
        session). Expects UNEXPECTED_POPUP with the popup text Gemini read.
        Best-effort dismisses the popup afterwards so the form is usable.
"""

import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-error")

TEST_DATE = "Thu, Aug 27th 2026"  # future date; only typed, never searched
STALE_READBACK = "010199"         # what the monkeypatched read-back reports


def _get_departure_edit(driver):
    trip_details = driver._get_trip_details_pane()
    return trip_details.children(control_type="Edit")[1]


def main():
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import PrimeError, TicketErrorCode
    from agent.date_utils import bookaway_date_to_prime

    p = argparse.ArgumentParser(
        description="Test the _type_date_field blocker check against live PRIME"
    )
    p.add_argument("mode", choices=["none", "popup"])
    args = p.parse_args()

    logger.info("=" * 60)
    logger.info(f"TEST: date-fill blocker check, mode={args.mode}")
    logger.info("=" * 60)
    if args.mode == "popup":
        logger.info("Expecting a popup to be blocking the form (manual setup).")
    else:
        logger.info("Expecting a CLEAN screen (no popup).")

    driver = PrimeDriver()
    driver.verify_issue_new_ticket_screen()

    prime_date = bookaway_date_to_prime(TEST_DATE)
    edit = _get_departure_edit(driver)

    # Simulate the read-back never matching, as a blocking modal causes in
    # production (keystrokes eaten, field keeps its stale value)
    real_read = driver._read_date_field
    driver._read_date_field = lambda e: STALE_READBACK

    expected = (
        TicketErrorCode.UNEXPECTED_POPUP
        if args.mode == "popup"
        else TicketErrorCode.PRIME_VALIDATION_ERROR
    )

    try:
        driver._type_date_field(edit, prime_date, "Departure")
        logger.error("FAIL: _type_date_field returned despite failing read-backs")
        sys.exit(1)
    except PrimeError as e:
        if e.error_code == expected:
            logger.info(f"PASS: Got expected error: {e.error_code.value} - {e.message}")
        else:
            logger.error(f"FAIL: Expected {expected.value}, got {e.error_code.value}: {e.message}")
            sys.exit(1)
    finally:
        driver._read_date_field = real_read

    if args.mode == "popup":
        # Best-effort cleanup so the form is usable for the next test run.
        # (For a real broken-session popup, re-login to PRIME manually.)
        logger.info("")
        logger.info("--- Cleanup: dismissing the staged popup ---")
        try:
            driver._dismiss_error_popup()
            driver.click_refresh()
        except Exception as cleanup_e:
            logger.warning(f"Cleanup incomplete — dismiss/refresh manually: {cleanup_e}")
    else:
        # Recovery: with the real read-back restored, a normal date fill on the
        # clean form must verify and return without raising
        logger.info("")
        logger.info("--- Recovery: real date fill should verify (should succeed) ---")
        edit = _get_departure_edit(driver)  # re-fetch; Refresh redrew the pane
        try:
            driver._type_date_field(edit, prime_date, "Departure")
            logger.info("PASS: Date fill verified successfully - recovery confirmed")
        except PrimeError as e:
            logger.error(f"FAIL: Recovery date fill failed: {e.error_code.value} - {e.message}")
            sys.exit(1)
        driver.click_refresh()

    logger.info("")
    logger.info("=" * 60)
    logger.info("TEST PASSED")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

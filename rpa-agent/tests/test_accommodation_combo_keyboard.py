"""Manual check: accommodation combo keyboard fallback

The Accom. Type Code combo is populated only after a voyage is selected, so
this fills Trip Details for a real voyage first (the production path,
including step 9's accommodation select), then exercises
_select_accommodation_by_typing() directly: each code in CODES, reading the
combo back after each, and finally 'XX', which must be refused. This is the
accommodation-only last resort added Oct 6, 2026 after a booking failed with
RPA_INTERNAL_ERROR while the accommodation list was dropped but pywinauto
enumerated no items.

While it runs, watch the form: after each PASS it should look the same as
after picking that class from the list by hand (rates included).

No ticket is issued. Run on the VM with PRIME open on Issue New Ticket and
the automation stopped:
    py tests/test_accommodation_combo_keyboard.py
    py tests/test_accommodation_combo_keyboard.py SIQ TAG "1:00 PM" OA,TC,OA

Arguments (all optional, positional): origin, destination, departure time,
comma-separated codes the voyage offers. The date is 3 days from today.
"""

import logging
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-accommodation-keyboard")

ORIGIN = sys.argv[1] if len(sys.argv) > 1 else "CEB"
DESTINATION = sys.argv[2] if len(sys.argv) > 2 else "TAG"
TIME = sys.argv[3] if len(sys.argv) > 3 else "6:00 AM"
CODES = (sys.argv[4] if len(sys.argv) > 4 else "TC,BC,TC").upper().split(",")
ABSENT_CODE = "XX"


def main():
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import PrimeError

    leg = {
        "origin": ORIGIN,
        "destination": DESTINATION,
        "date": (datetime.now() + timedelta(days=3)).strftime("%a, %b %d %Y"),
        "time": TIME,
        "accommodation": CODES[0],
    }

    logger.info("=" * 60)
    logger.info(
        f"TEST: accommodation combo keyboard fallback "
        f"({ORIGIN}->{DESTINATION} {leg['date']} {TIME}, codes {CODES})"
    )
    logger.info("=" * 60)

    driver = PrimeDriver()
    driver.click_refresh()

    # 1. Production path up to and including the accommodation select
    logger.info("")
    logger.info("--- Filling trip details (production path) ---")
    try:
        driver.fill_trip_details(leg, "One Way")
        logger.info(f"PASS: trip details filled, accommodation '{CODES[0]}' selected")
    except PrimeError as e:
        logger.error(f"FAIL: trip details did not fill: [{e.error_code.value}] {e}")
        driver._dismiss_error_popup()
        driver.click_refresh()
        sys.exit(1)

    trip_details = driver._get_trip_details_pane()
    failures = 0

    # 2. Typed selection of each code the voyage offers
    logger.info("")
    logger.info("--- Typing each code directly ---")
    for code in CODES:
        if driver._select_accommodation_by_typing(trip_details, code):
            logger.info(f"PASS: '{code}' selected and verified via keyboard")
        else:
            logger.error(f"FAIL: '{code}' not verified via keyboard")
            failures += 1

    # 3. A code no voyage offers must be refused
    logger.info("")
    logger.info(f"--- Typing absent code '{ABSENT_CODE}' (must be refused) ---")
    if driver._select_accommodation_by_typing(trip_details, ABSENT_CODE):
        logger.error(f"FAIL: absent code '{ABSENT_CODE}' was reported as selected")
        failures += 1
    else:
        logger.info(f"PASS: absent code '{ABSENT_CODE}' refused")

    driver.click_refresh()

    logger.info("")
    logger.info("=" * 60)
    if failures:
        logger.error(f"TEST FAILED ({failures} of {len(CODES) + 1} checks did not pass)")
        sys.exit(1)
    logger.info("TEST PASSED")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

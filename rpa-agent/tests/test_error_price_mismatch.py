"""Manual check: PRICE_MISMATCH — the Confirm popup is declined, no ticket.

Exercises the production price check on a real voyage with a deliberately
wrong expectation (default: Bookaway cost 1.00 PHP → expected PRIME 1.05), so
whatever PRIME's Total Due is, the driver must:
  1. read the Rates pane with the Confirm popup open (Gemini),
  2. click No (never Yes),
  3. raise PrimeError(PRICE_MISMATCH) whose message carries both prices.
Then it checks the popup is gone and refreshes the form.

Pass the real Bookaway cost to see the message a true mismatch would produce
is a MATCH instead — that path is NOT run here because it would issue a ticket.

No ticket is issued. Run on the VM with PRIME open on Issue New Ticket and the
automation stopped:
    py tests/test_error_price_mismatch.py
    py tests/test_error_price_mismatch.py CEB TAG "6:00 AM" BC

Arguments (all optional, positional): origin, destination, departure time,
accommodation code. The date is 3 days from today.
"""

import logging
import os
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-price-mismatch")

ORIGIN = sys.argv[1] if len(sys.argv) > 1 else "CEB"
DESTINATION = sys.argv[2] if len(sys.argv) > 2 else "TAG"
TIME = sys.argv[3] if len(sys.argv) > 3 else "6:00 AM"
ACCOMMODATION = (sys.argv[4] if len(sys.argv) > 4 else "TC").upper()

WRONG_BOOKAWAY_COST = 1.00  # PHP — no PRIME fare is this low
DISCOUNT_RATE = 0.05

TEST_PASSENGER = {
    "firstName": "PRICEPROBE",
    "lastName": "DONOTISSUE",
    "age": "30",
    "gender": "Male",
}


def main():
    from pywinauto import Desktop
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import PrimeError, TicketErrorCode

    leg = {
        "origin": ORIGIN,
        "destination": DESTINATION,
        "date": (datetime.now() + timedelta(days=3)).strftime("%a, %b %d %Y"),
        "time": TIME,
        "accommodation": ACCOMMODATION,
    }
    price_check = {
        "expected_total": WRONG_BOOKAWAY_COST / (1 - DISCOUNT_RATE),
        "bookaway_cost": WRONG_BOOKAWAY_COST,
        "prior_total": 0.0,
        "is_last_leg": True,
        "label": "Pax 1/1 departure (TEST)",
        "reference": "BWTEST",
        "issued_tickets": [],
    }

    logger.info("=" * 60)
    logger.info(f"TEST: PRICE_MISMATCH ({ORIGIN}->{DESTINATION} {leg['date']} {TIME} {ACCOMMODATION})")
    logger.info("=" * 60)

    driver = PrimeDriver()
    driver.click_refresh()

    try:
        driver.fill_trip_details(leg, "One Way")
        driver.fill_personal_details(TEST_PASSENGER, "price-test@bookaway.com")
    except PrimeError as e:
        logger.error(f"FAIL: form did not fill: [{e.error_code.value}] {e}")
        driver._dismiss_error_popup()
        driver.click_refresh()
        sys.exit(1)

    logger.info("--- Issue → price check must decline the Confirm popup ---")
    driver.click_issue()
    passed = False
    try:
        tickets = driver.handle_issue_result(price_check=price_check)
        logger.error(f"FAIL: a ticket was ISSUED despite the wrong price: {tickets}")
    except PrimeError as e:
        if e.error_code == TicketErrorCode.PRICE_MISMATCH:
            logger.info(f"PASS: raised PRICE_MISMATCH: {e.message}")
            passed = True
        else:
            logger.error(f"FAIL: raised [{e.error_code.value}] instead of PRICE_MISMATCH: {e.message}")

    time.sleep(1)
    try:
        still_open = Desktop(backend="uia").window(title="Confirm").exists(timeout=0.5)
    except Exception:
        still_open = False
    if still_open:
        logger.error("FAIL: Confirm popup is still open; NOT touching it. Close it by hand with No.")
        passed = False
    else:
        logger.info("PASS: Confirm popup closed")

    driver._dismiss_error_popup()
    driver.click_refresh()

    logger.info("=" * 60)
    logger.info("TEST PASSED" if passed else "TEST FAILED")
    logger.info("Crop sent to Gemini: debug/rates_BWTEST_*.png")
    logger.info("=" * 60)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()

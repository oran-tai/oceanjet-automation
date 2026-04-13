"""Error test: TRIP_SOLD_OUT (after Confirm → Yes)

Verifies the post-Confirm sold-out detection path and the child-dialog
popup dismissal fallback added in 225baf5.

Scenario: SIQ → DUM on April 13 2026, voyage OJ306 at 6:00 PM. The TC
accommodation on this voyage is sold out (Available: 0 observed in
production logs on 2026-04-13). PRIME accepts the voyage selection
and the personal details, but after Issue → Confirm → Yes the success
popup never appears — instead a child dialog reading "No Tourist Class
seats available." pops up under main_window.

Expected flow:
1. fill_trip_details succeeds (voyage exists, TC is selectable)
2. fill_personal_details succeeds (no COMError blocking the form)
3. click_issue + Confirm → Yes proceeds
4. handle_issue_result polls for the ticket popup, times out
5. _check_error_after_confirm screenshots the main window, Gemini reads
   the popup text, classifies as sold-out → raises TRIP_SOLD_OUT
6. except block runs _dismiss_error_popup() + click_refresh() +
   _dismiss_error_popup() — the child-dialog fallback must find and
   click OK on the popup. Look for log line:
       "Dismissed error popup (child dialog)"
7. Recovery: valid CEB → TAG booking fills cleanly (proves the popup
   did not leak into the next booking)

Run on the VM with PRIME open on Issue New Ticket:
    py tests/test_error_trip_sold_out.py
"""

import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-error")

SOLD_OUT_BOOKING = {
    "bookingId": "err-soldout-001",
    "reference": "ERR-SOLDOUT-001",
    "bookingType": "one-way",
    "passengers": [
        {
            "firstName": "Russel",
            "lastName": "Batoon",
            "age": "63",
            "gender": "Female",
        }
    ],
    "departureLeg": {
        "origin": "SIQ",
        "destination": "DUM",
        "date": "Mon, Apr 13th 2026",
        "time": "6:00 PM",
        "accommodation": "TC",
    },
    "contactInfo": "test@deped.gov.ph",
}

RECOVERY_LEG = {
    "origin": "CEB",
    "destination": "TAG",
    "date": "Fri, Mar 27th 2026",
    "time": "6:00 AM",
    "accommodation": "TC",
}

RECOVERY_PAX = {
    "firstName": "Juan",
    "lastName": "Dela Cruz",
    "age": "30",
    "gender": "Male",
}


def main():
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import TicketErrorCode

    logger.info("=" * 60)
    logger.info("TEST: TRIP_SOLD_OUT (post-Confirm) + popup dismissal + recovery")
    logger.info("=" * 60)

    driver = PrimeDriver()

    logger.info("")
    logger.info("--- Booking 1: SIQ->DUM OJ306 TC (sold out, should fail) ---")
    result = driver.fill_booking(SOLD_OUT_BOOKING)
    if not result["success"] and result.get("errorCode") == TicketErrorCode.TRIP_SOLD_OUT.value:
        logger.info(f"PASS: Got expected error: {result['errorCode']} - {result.get('error')}")
    elif result["success"]:
        logger.error("FAIL: Expected TRIP_SOLD_OUT but fill_booking succeeded")
        logger.error("(TC may no longer be sold out on this voyage — pick another)")
        sys.exit(1)
    else:
        logger.error(f"FAIL: Expected TRIP_SOLD_OUT, got {result.get('errorCode')}")
        logger.error(f"Error message: {result.get('error')}")
        sys.exit(1)

    # Recovery: fill a valid CEB->TAG booking WITHOUT clicking Issue.
    # We only care that the form is interactable after the sold-out error,
    # which proves the popup was dismissed. Skipping click_issue avoids
    # generating a real ticket on every test run.
    logger.info("")
    logger.info("--- Recovery: fill CEB->TAG form (no Issue click) ---")
    logger.info("If the sold-out popup is still on screen, these calls will fail.")
    try:
        driver.click_refresh()
        driver.fill_trip_details(RECOVERY_LEG, "One Way")
        driver.fill_personal_details(RECOVERY_PAX, "test@example.com")
        logger.info("PASS: Form filled cleanly - sold-out popup was dismissed")
    except Exception as e:
        logger.error(f"FAIL: Recovery form fill failed: {e}")
        logger.error("This likely means the sold-out popup was NOT dismissed.")
        sys.exit(1)

    # Clean up: refresh the form so the test leaves PRIME in a clean state.
    logger.info("")
    logger.info("--- Cleanup: refreshing form ---")
    driver.click_refresh()

    logger.info("")
    logger.info("=" * 60)
    logger.info("TEST PASSED")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

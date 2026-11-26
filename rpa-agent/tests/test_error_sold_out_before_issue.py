"""Error test: TRIP_SOLD_OUT from the direct popup check (before Issue)

Since Nov 26, 2026 the Sex combo is typed first, and the typed select works
with a sold-out popup on screen, so fill_booking looks for the popup itself
(_form_popup_present) right after the trip fill and again after the personal
details, then runs _check_sold_out_after_voyage.

Scenario: a voyage whose accommodation class has no seats. PRIME shows
'No <Class> Seats Available.' once the class is selected.

Expected flow:
1. fill_trip_details succeeds; the popup is up
2. _form_popup_present() finds it -> _check_sold_out_after_voyage() ->
   TRIP_SOLD_OUT with the popup text and the seat counts
3. The passenger is never typed and Issue is never reached
4. Cleanup dismisses the popup; no popup is left on screen

Safety: click_issue is replaced for this run, so no ticket can be issued
even if the class turns out to have seats (the test then fails).

Run on the VM with PRIME open on Issue New Ticket and the automation stopped
on that VM:
    py tests/test_error_sold_out_before_issue.py
    py tests/test_error_sold_out_before_issue.py CEB TAG "2:00 PM" BC "Thu, Nov 26th 2026"

Arguments (all optional, positional): origin, destination, departure time,
accommodation code that is sold out, date.
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

ORIGIN = sys.argv[1] if len(sys.argv) > 1 else "CEB"
DESTINATION = sys.argv[2] if len(sys.argv) > 2 else "TAG"
TIME = sys.argv[3] if len(sys.argv) > 3 else "2:00 PM"
CODE = (sys.argv[4] if len(sys.argv) > 4 else "BC").upper()
DATE = sys.argv[5] if len(sys.argv) > 5 else "Thu, Nov 26th 2026"

BOOKING = {
    "bookingId": "err-soldout-pre-issue-001",
    "reference": "ERR-SOLDOUT-PRE-ISSUE-001",
    "bookingType": "one-way",
    "passengers": [
        {
            "firstName": "Test",
            "lastName": "Soldout",
            "age": "30",
            "gender": "Female",
        }
    ],
    "departureLeg": {
        "origin": ORIGIN,
        "destination": DESTINATION,
        "date": DATE,
        "time": TIME,
        "accommodation": CODE,
    },
    "contactInfo": "test@example.com",
}


def main():
    from agent.error_codes import PrimeError, TicketErrorCode
    from agent.prime_driver import PrimeDriver

    logger.info("=" * 60)
    logger.info(f"TEST: TRIP_SOLD_OUT before Issue ({ORIGIN}->{DESTINATION} {DATE} {TIME} {CODE})")
    logger.info("=" * 60)

    driver = PrimeDriver()

    issue_reached = []

    def blocked_issue():
        issue_reached.append(True)
        raise PrimeError(
            TicketErrorCode.RPA_INTERNAL_ERROR,
            "TEST GUARD: Issue was reached, so the popup was not detected (Issue not clicked)",
        )

    driver.click_issue = blocked_issue

    result = driver.fill_booking(BOOKING)

    failed = False
    if issue_reached:
        logger.error("FAIL: the flow reached Issue (blocked by the test, no ticket)")
        logger.error("Either the popup was not detected or this class still has seats.")
        failed = True
    elif result.get("errorCode") == TicketErrorCode.TRIP_SOLD_OUT.value:
        logger.info(f"PASS: {result['errorCode']} - {result.get('error')}")
    else:
        logger.error(f"FAIL: expected TRIP_SOLD_OUT, got {result.get('errorCode')} - {result.get('error')}")
        failed = True

    if driver._form_popup_present():
        logger.error("FAIL: a popup is still on screen after cleanup")
        failed = True
    else:
        logger.info("PASS: no popup left on screen after cleanup")

    driver.click_refresh()

    logger.info("")
    logger.info("=" * 60)
    logger.info("TEST FAILED" if failed else "TEST PASSED")
    logger.info("=" * 60)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

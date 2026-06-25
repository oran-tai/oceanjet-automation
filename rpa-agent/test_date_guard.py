"""Standalone PRIME test for the stale-date-field guards (no orchestrator, no Bookaway).

Run on the VM with PRIME open on the "Issue New Ticket" screen, logged in.
NONE of these modes click Issue — no real ticket is ever created.

Modes:
  py test_date_guard.py readback --date "Thu, Jun 25th 2026"
        Types the date into PRIME's Departure Date field, reads it back, and
        prints what UIA returned. Answers the open question: can we read the
        masked edit on this machine? (If it prints the date -> read-back works.)

  py test_date_guard.py happy --origin CEB --dest TAG \
        --date "Thu, Jun 25th 2026" --time "1:00 PM"
        Fills a real, bookable leg and runs select_voyage with the CORRECT date.
        The voyage-date guard should stay silent and a voyage gets selected.
        Stops before Issue.

  py test_date_guard.py guard --origin CEB --dest TAG \
        --date "Thu, Jun 25th 2026" --time "1:00 PM" --wrong-date "Mon, Jul 13th 2026"
        Types the REAL date (grid is filtered to it) but tells select_voyage to
        expect a DIFFERENT date — simulating a stale field. The guard MUST raise
        VOYAGE_TIME_MISMATCH. This reproduces BW5276308 and proves the catch.
"""

import argparse
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("test-date-guard")


def _setup_form(driver, origin, dest, date_str):
    """Replicate fill_trip_details steps 1-6 (One Way) up to opening the voyage
    grid, so we can call select_voyage ourselves with a chosen expected_date."""
    from agent.date_utils import bookaway_date_to_prime

    driver.verify_issue_new_ticket_screen()
    driver.click_refresh()

    trip_details = driver._get_trip_details_pane()
    trip_type_pane = driver._get_trip_type_pane()
    trip_type_pane.child_window(title="One Way", control_type="RadioButton").click_input()

    edits = trip_details.children(control_type="Edit")
    combos = trip_details.children(control_type="ComboBox")

    prime_date = bookaway_date_to_prime(date_str)
    driver._type_date_field(edits[1], prime_date, "Departure")          # exercises read-back
    driver._select_station_with_recovery(combos[2], origin, "origin")
    driver._dismiss_same_station_dialog()
    driver._select_station_with_recovery(combos[1], dest, "destination")
    driver._dismiss_same_station_dialog()

    buttons = trip_details.children(control_type="Button")
    buttons[1].click_input()   # open Voyage Schedule


def main():
    p = argparse.ArgumentParser(description="Test stale-date-field guards against live PRIME")
    p.add_argument("mode", choices=["readback", "happy", "guard"])
    p.add_argument("--origin", default="CEB")
    p.add_argument("--dest", default="TAG")
    p.add_argument("--date", required=True, help='Bookaway format, e.g. "Thu, Jun 25th 2026"')
    p.add_argument("--time", default="1:00 PM", help='e.g. "1:00 PM"')
    p.add_argument("--wrong-date", help='For guard mode, e.g. "Mon, Jul 13th 2026"')
    args = p.parse_args()

    logger.info("Make sure PRIME is open on Issue New Ticket and logged in. No ticket will be issued.")

    from agent.prime_driver import PrimeDriver
    from agent.date_utils import bookaway_date_to_prime, normalize_prime_date_field
    from agent.error_codes import PrimeError, TicketErrorCode

    driver = PrimeDriver()

    if args.mode == "readback":
        driver.verify_issue_new_ticket_screen()
        driver.click_refresh()
        trip_details = driver._get_trip_details_pane()
        edit = trip_details.children(control_type="Edit")[1]
        want = bookaway_date_to_prime(args.date)
        driver._type_date_field(edit, want, "Departure")
        got = normalize_prime_date_field(driver._read_date_field(edit))
        logger.info(f"Typed {want!r}; field reads back {got!r}")
        if not got:
            logger.warning("READ-BACK RETURNED EMPTY — UIA can't read this masked edit on this "
                           "machine. _type_date_field can't self-verify; rely on the voyage-date "
                           "guard (and consider an OCR fallback).")
        elif got == want:
            logger.info("READ-BACK OK — the date verification will work in production.")
        else:
            logger.error(f"MISMATCH — field shows {got}, expected {want}.")
        return

    if args.mode == "happy":
        _setup_form(driver, args.origin, args.dest, args.date)
        result = driver.select_voyage(args.time, cache_key=None, expected_date=args.date)
        logger.info(f"PASS — guard stayed silent, selected voyage {result['voyage_number']} "
                    f"(arr {result['arrival_time']}). No Issue clicked.")
        return

    # guard mode: type real date, but expect a different one -> must raise
    if not args.wrong_date:
        p.error("guard mode requires --wrong-date")
    _setup_form(driver, args.origin, args.dest, args.date)
    try:
        driver.select_voyage(args.time, cache_key=None, expected_date=args.wrong_date)
        logger.error("FAIL — select_voyage did NOT raise; the guard let a wrong-date booking "
                     "through. (A voyage may now be selected in PRIME — click Refresh.)")
        sys.exit(1)
    except PrimeError as e:
        if e.error_code == TicketErrorCode.VOYAGE_TIME_MISMATCH:
            logger.info(f"PASS — guard fired as expected: {e.message}")
        else:
            logger.error(f"FAIL — raised wrong code {e.error_code}: {e.message}")
            sys.exit(1)


if __name__ == "__main__":
    main()

"""Standalone test script: fill PRIME form with hardcoded booking data.

Run on the VM with PRIME open:
    py test_fill_form.py              # one-way
    py test_fill_form.py --round-trip
    py test_fill_form.py --connecting
"""

import argparse
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-fill")


ONE_WAY_BOOKING = {
    "bookingId": "test-001",
    "reference": "TEST-OW-001",
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

ROUND_TRIP_BOOKING = {
    "bookingId": "test-002",
    "reference": "TEST-RT-002",
    "bookingType": "round-trip",
    "passengers": [
        {
            "firstName": "Maria",
            "lastName": "Santos",
            "age": "25",
            "gender": "Female",
        }
    ],
    "departureLeg": {
        "origin": "CEB",
        "destination": "TAG",
        "date": "Fri, Mar 27th 2026",
        "time": "6:00 AM",
        "accommodation": "TC",
    },
    "returnLeg": {
        "origin": "TAG",
        "destination": "CEB",
        "date": "Sun, Mar 29th 2026",
        "time": "10:40 AM",
        "accommodation": "TC",
    },
    "contactInfo": "test@example.com",
}

INVALID_STATION_BOOKING = {
    "bookingId": "test-err-001",
    "reference": "TEST-ERR-STATION",
    "bookingType": "one-way",
    "passengers": [
        {
            "firstName": "Bad",
            "lastName": "Station",
            "age": "25",
            "gender": "Male",
        }
    ],
    "departureLeg": {
        "origin": "ABC",
        "destination": "TAG",
        "date": "Fri, Mar 27th 2026",
        "time": "6:00 AM",
        "accommodation": "TC",
    },
    "contactInfo": "test@example.com",
}

CONNECTING_BOOKING = {
    "bookingId": "test-003",
    "reference": "TEST-CN-003",
    "bookingType": "connecting-one-way",
    "passengers": [
        {
            "firstName": "Pedro",
            "lastName": "Reyes",
            "age": "35",
            "gender": "Male",
        }
    ],
    "departureLeg": {
        "origin": "CEB",
        "destination": "SIQ",
        "date": "Fri, Mar 27th 2026",
        "time": "1:00 PM",
        "accommodation": "TC",
    },
    "connectingLegs": [
        {
            "origin": "CEB",
            "destination": "TAG",
            "date": "Fri, Mar 27th 2026",
            "time": "1:00 PM",
            "accommodation": "TC",
        },
        {
            "origin": "TAG",
            "destination": "SIQ",
            "date": "Fri, Mar 27th 2026",
            "time": "3:20 PM",
            "accommodation": "TC",
        },
    ],
    "contactInfo": "test@example.com",
}


def debug_controls():
    """Dump the PRIME control tree so we can see what pywinauto finds."""
    from pywinauto import Application
    from agent.config import PRIME_WINDOW_TITLE, PRIME_TIMEOUT_SEC

    logger.info(f"Connecting to PRIME: {PRIME_WINDOW_TITLE}")
    app = Application(backend="uia").connect(
        title=PRIME_WINDOW_TITLE, timeout=PRIME_TIMEOUT_SEC
    )
    win = app.window(title=PRIME_WINDOW_TITLE)

    # Find Trip Details pane (name has surrounding spaces in PRIME)
    logger.info("Looking for Trip Details pane...")
    try:
        trip_pane = win.child_window(title_re=" *Trip Details *", control_type="Pane")
        logger.info("Found Trip Details pane! Dumping children (depth=3)...")
        trip_pane.print_control_identifiers(depth=3)
    except Exception as e:
        logger.error(f"Could not find Trip Details pane: {e}")
        logger.info("Dumping full window tree (depth=8)...")
        win.print_control_identifiers(depth=8)


def main():
    parser = argparse.ArgumentParser(description="Test PRIME form fill")
    parser.add_argument("--round-trip", action="store_true", help="Test round-trip booking")
    parser.add_argument("--connecting", action="store_true", help="Test connecting route booking")
    parser.add_argument("--debug", action="store_true", help="Dump PRIME control tree and exit")
    parser.add_argument("--test-errors", action="store_true",
                        help="Test error handling: invalid booking then valid booking")
    args = parser.parse_args()

    if args.debug:
        debug_controls()
        return

    if args.test_errors:
        test_error_handling()
        return

    if args.round_trip:
        booking = ROUND_TRIP_BOOKING
    elif args.connecting:
        booking = CONNECTING_BOOKING
    else:
        booking = ONE_WAY_BOOKING

    logger.info(f"Testing {booking['bookingType']} booking: {booking['reference']}")
    logger.info("Make sure PRIME is open and logged in!")

    from agent.prime_driver import PrimeDriver

    try:
        driver = PrimeDriver()
        driver.fill_booking(booking)
        logger.info("SUCCESS: Form fill complete. Check PRIME via AnyDesk to verify fields.")
    except Exception as e:
        logger.error(f"FAILED: {e}")
        sys.exit(1)


def test_error_handling():
    """Simulate orchestrator behavior: invalid booking fails, valid booking succeeds."""
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import PrimeError, SYSTEM_ERROR_CODES

    bookings = [
        ("INVALID STATION (should fail with STATION_NOT_FOUND)", INVALID_STATION_BOOKING),
        ("VALID BOOKING (should succeed)", ONE_WAY_BOOKING),
    ]

    logger.info("=" * 60)
    logger.info("ERROR HANDLING TEST: 2 bookings (1 invalid, 1 valid)")
    logger.info("=" * 60)

    driver = PrimeDriver()

    for description, booking in bookings:
        logger.info("")
        logger.info(f"--- {description} ---")
        logger.info(f"Booking: {booking['reference']}")

        try:
            driver.fill_booking(booking)
            logger.info(f"RESULT: SUCCESS - form filled for {booking['reference']}")
        except PrimeError as e:
            logger.warning(f"RESULT: {e.error_code.value} - {e.message}")

            if e.error_code in SYSTEM_ERROR_CODES:
                logger.error("SYSTEM ERROR - orchestrator would STOP the loop here")
                break
            else:
                logger.info("BOOKING ERROR - orchestrator would release, alert, and CONTINUE")
                logger.info("Clicking Refresh to reset form before next booking...")
                try:
                    driver.click_refresh()
                except Exception:
                    pass
                continue
        except Exception as e:
            logger.error(f"RESULT: UNEXPECTED ERROR - {e}")
            break

    logger.info("")
    logger.info("=" * 60)
    logger.info("ERROR HANDLING TEST COMPLETE")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

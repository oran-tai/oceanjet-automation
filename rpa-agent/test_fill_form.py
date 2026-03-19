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
    args = parser.parse_args()

    if args.debug:
        debug_controls()
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
        result = driver.fill_booking(booking)
        if result["success"]:
            logger.info("SUCCESS: Form fill complete. Check PRIME via AnyDesk to verify fields.")
        else:
            logger.error(f"FAILED: {result.get('errorCode')} - {result.get('error')}")
            if result.get("partialResults"):
                for pr in result["partialResults"]:
                    status = "OK" if pr["success"] else f"FAILED ({pr.get('errorCode')})"
                    logger.info(f"  {pr['passengerName']}: {status}")
            sys.exit(1)
    except Exception as e:
        logger.error(f"FAILED: {e}")
        sys.exit(1)




if __name__ == "__main__":
    main()

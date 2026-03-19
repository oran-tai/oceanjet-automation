"""Error test: STATION_NOT_FOUND

Verifies that the RPA raises STATION_NOT_FOUND when a booking has an
invalid origin station, then recovers and successfully fills a valid booking.

Run on the VM with PRIME open on Issue New Ticket:
    py tests/test_error_station_not_found.py
"""

import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-error")

INVALID_BOOKING = {
    "bookingId": "err-station-001",
    "reference": "ERR-STATION-001",
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

VALID_BOOKING = {
    "bookingId": "err-station-002",
    "reference": "ERR-STATION-002",
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


def main():
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import PrimeError, TicketErrorCode

    logger.info("=" * 60)
    logger.info("TEST: STATION_NOT_FOUND error + recovery")
    logger.info("=" * 60)

    driver = PrimeDriver()

    # 1. Invalid booking should raise STATION_NOT_FOUND
    logger.info("")
    logger.info("--- Booking 1: invalid origin 'ABC' (should fail) ---")
    try:
        driver.fill_booking(INVALID_BOOKING)
        logger.error("FAIL: Expected STATION_NOT_FOUND but fill_booking succeeded")
        sys.exit(1)
    except PrimeError as e:
        if e.error_code == TicketErrorCode.STATION_NOT_FOUND:
            logger.info(f"PASS: Got expected error: {e.error_code.value} - {e.message}")
        else:
            logger.error(f"FAIL: Expected STATION_NOT_FOUND, got {e.error_code.value}")
            sys.exit(1)

    # 2. Reset form
    logger.info("")
    logger.info("--- Resetting form for next booking ---")
    driver.click_refresh()

    # 3. Valid booking should succeed
    logger.info("")
    logger.info("--- Booking 2: valid CEB->TAG (should succeed) ---")
    try:
        driver.fill_booking(VALID_BOOKING)
        logger.info("PASS: Valid booking filled successfully - recovery confirmed")
    except Exception as e:
        logger.error(f"FAIL: Valid booking failed after recovery: {e}")
        sys.exit(1)

    logger.info("")
    logger.info("=" * 60)
    logger.info("TEST PASSED")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

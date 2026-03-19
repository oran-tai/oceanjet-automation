"""Error test: STATION_NOT_FOUND

Verifies that the RPA raises STATION_NOT_FOUND when a booking has an
invalid origin station, then recovers and successfully fills a valid booking.

Run on the VM with PRIME open on Issue New Ticket:
    py -m pytest tests/test_error_station_not_found.py -v -s
"""

import logging

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


def test_station_not_found_then_recovery():
    """Invalid station fails with STATION_NOT_FOUND, then valid booking succeeds."""
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import PrimeError, TicketErrorCode

    driver = PrimeDriver()

    # 1. Invalid booking should raise STATION_NOT_FOUND
    logger.info("--- Booking 1: invalid origin 'ABC' (should fail) ---")
    try:
        driver.fill_booking(INVALID_BOOKING)
        assert False, "Expected PrimeError but fill_booking succeeded"
    except PrimeError as e:
        logger.info(f"Got expected error: {e.error_code.value} - {e.message}")
        assert e.error_code == TicketErrorCode.STATION_NOT_FOUND, (
            f"Expected STATION_NOT_FOUND, got {e.error_code.value}"
        )

    # 2. Reset form
    logger.info("--- Resetting form ---")
    driver.click_refresh()

    # 3. Valid booking should succeed
    logger.info("--- Booking 2: valid CEB->TAG (should succeed) ---")
    driver.fill_booking(VALID_BOOKING)
    logger.info("Valid booking filled successfully - recovery confirmed")

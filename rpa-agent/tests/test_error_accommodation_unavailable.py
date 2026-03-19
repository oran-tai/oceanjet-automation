"""Error test: ACCOMMODATION_UNAVAILABLE

Verifies that the RPA raises ACCOMMODATION_UNAVAILABLE when a booking
requests a non-existent accommodation code, then recovers and
successfully fills a valid booking.

Run on the VM with PRIME open on Issue New Ticket:
    py tests/test_error_accommodation_unavailable.py
"""

import logging
import os
import sys

# Ensure agent package is importable when running as standalone script
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-error")

INVALID_BOOKING = {
    "bookingId": "err-accom-001",
    "reference": "ERR-ACCOM-001",
    "bookingType": "one-way",
    "passengers": [
        {
            "firstName": "Bad",
            "lastName": "Cabin",
            "age": "25",
            "gender": "Male",
        }
    ],
    "departureLeg": {
        "origin": "CEB",
        "destination": "TAG",
        "date": "Fri, Mar 27th 2026",
        "time": "6:00 AM",
        "accommodation": "XX",
    },
    "contactInfo": "test@example.com",
}

VALID_BOOKING = {
    "bookingId": "err-accom-002",
    "reference": "ERR-ACCOM-002",
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
    logger.info("TEST: ACCOMMODATION_UNAVAILABLE error + recovery")
    logger.info("=" * 60)

    driver = PrimeDriver()

    # 1. Booking with fake accommodation "XX" should return ACCOMMODATION_UNAVAILABLE
    logger.info("")
    logger.info("--- Booking 1: invalid accommodation 'XX' (should fail) ---")
    result = driver.fill_booking(INVALID_BOOKING)
    if not result["success"] and result.get("errorCode") == TicketErrorCode.ACCOMMODATION_UNAVAILABLE.value:
        logger.info(f"PASS: Got expected error: {result['errorCode']} - {result.get('error')}")
        from agent.notifications import notify_booking_error
        notify_booking_error(
            INVALID_BOOKING["reference"],
            result["errorCode"],
            result.get("error", ""),
        )
        logger.info("Slack alert sent")
    elif result["success"]:
        logger.error("FAIL: Expected ACCOMMODATION_UNAVAILABLE but fill_booking succeeded")
        sys.exit(1)
    else:
        logger.error(f"FAIL: Expected ACCOMMODATION_UNAVAILABLE, got {result.get('errorCode')}")
        sys.exit(1)

    # 2. Reset form
    logger.info("")
    logger.info("--- Resetting form for next booking ---")
    driver.click_refresh()

    # 3. Valid booking should succeed
    logger.info("")
    logger.info("--- Booking 2: valid CEB->TAG with TC (should succeed) ---")
    result = driver.fill_booking(VALID_BOOKING)
    if result["success"]:
        logger.info("PASS: Valid booking filled successfully - recovery confirmed")
    else:
        logger.error(f"FAIL: Valid booking failed after recovery: {result.get('error')}")
        sys.exit(1)

    logger.info("")
    logger.info("=" * 60)
    logger.info("TEST PASSED")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

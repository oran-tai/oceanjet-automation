"""Error test: VOYAGE_TIME_MISMATCH

Verifies that the RPA raises VOYAGE_TIME_MISMATCH when a booking requests
a departure time that doesn't match any available voyage (2:00 AM),
then recovers and successfully fills a valid booking.

Run on the VM with PRIME open on Issue New Ticket:
    py tests/test_error_voyage_time_mismatch.py
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
    "bookingId": "err-voyage-001",
    "reference": "ERR-VOYAGE-001",
    "bookingType": "one-way",
    "passengers": [
        {
            "firstName": "Wrong",
            "lastName": "Time",
            "age": "25",
            "gender": "Male",
        }
    ],
    "departureLeg": {
        "origin": "CEB",
        "destination": "TAG",
        "date": "Fri, Mar 27th 2026",
        "time": "2:00 AM",
        "accommodation": "TC",
    },
    "contactInfo": "test@example.com",
}

VALID_BOOKING = {
    "bookingId": "err-voyage-002",
    "reference": "ERR-VOYAGE-002",
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
    logger.info("TEST: VOYAGE_TIME_MISMATCH error + recovery")
    logger.info("=" * 60)

    driver = PrimeDriver()

    # 1. Booking with 2:00 AM should return VOYAGE_TIME_MISMATCH (no ferry at that hour)
    logger.info("")
    logger.info("--- Booking 1: departure at 2:00 AM (should fail) ---")
    result = driver.fill_booking(INVALID_BOOKING)
    if not result["success"] and result.get("errorCode") == TicketErrorCode.VOYAGE_TIME_MISMATCH.value:
        logger.info(f"PASS: Got expected error: {result['errorCode']} - {result.get('error')}")
        # Send Slack alert like the orchestrator would
        from agent.notifications import notify_booking_error
        notify_booking_error(
            INVALID_BOOKING["reference"],
            result["errorCode"],
            result.get("error", ""),
        )
        logger.info("Slack alert sent")
    elif result["success"]:
        logger.error("FAIL: Expected VOYAGE_TIME_MISMATCH but fill_booking succeeded")
        sys.exit(1)
    else:
        logger.error(f"FAIL: Expected VOYAGE_TIME_MISMATCH, got {result.get('errorCode')}")
        sys.exit(1)

    # 2. Reset form
    logger.info("")
    logger.info("--- Resetting form for next booking ---")
    driver.click_refresh()

    # 3. Valid booking should succeed
    logger.info("")
    logger.info("--- Booking 2: valid CEB->TAG at 6:00 AM (should succeed) ---")
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

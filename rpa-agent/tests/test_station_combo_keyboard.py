"""Manual check: station combo keyboard fallback

Exercises _select_station_by_typing() directly on the Origin combo of the
Trip Details pane, on a fresh form: TAG, then CEB, then TAG, reading the
combo back after each. This is the station-only last resort added Sept 26,
2026 after a booking failed with RPA_INTERNAL_ERROR while the Origin list
was visibly dropped but pywinauto enumerated no items.

No ticket is issued. Run on the VM with PRIME open on Issue New Ticket:
    py tests/test_station_combo_keyboard.py
"""

import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-station-keyboard")

ORIGIN_INDEX = 2  # ComboBox index within Trip Details (2 = origin, 1 = destination)


def main():
    from agent.prime_driver import PrimeDriver

    logger.info("=" * 60)
    logger.info("TEST: station combo keyboard fallback (TAG -> CEB -> TAG)")
    logger.info("=" * 60)

    driver = PrimeDriver()
    driver.click_refresh()
    trip_details = driver._get_trip_details_pane()

    failures = 0
    for code in ("TAG", "CEB", "TAG"):
        if driver._select_station_by_typing(trip_details, ORIGIN_INDEX, code, "origin"):
            logger.info(f"PASS: '{code}' selected and verified via keyboard")
        else:
            logger.error(f"FAIL: '{code}' not verified via keyboard")
            failures += 1

    driver.click_refresh()

    logger.info("")
    logger.info("=" * 60)
    if failures:
        logger.error(f"TEST FAILED ({failures} of 3 selections did not verify)")
        sys.exit(1)
    logger.info("TEST PASSED")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

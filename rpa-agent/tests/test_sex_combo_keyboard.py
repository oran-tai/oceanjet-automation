"""Manual check: Sex combo keyboard fallback

Exercises _select_sex_by_typing() directly on the Sex combo of the Personal
Details pane, on a fresh form: M, then F, then M, reading the combo back
after each. This is the Sex-only last resort added Sept 25, 2026 after a
booking failed with RPA_INTERNAL_ERROR while the Sex list was visibly
dropped but pywinauto enumerated no items.

No ticket is issued. Run on the VM with PRIME open on Issue New Ticket:
    py tests/test_sex_combo_keyboard.py
"""

import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-sex-keyboard")


def main():
    from agent.prime_driver import PrimeDriver

    logger.info("=" * 60)
    logger.info("TEST: Sex combo keyboard fallback (M -> F -> M)")
    logger.info("=" * 60)

    driver = PrimeDriver()
    driver.click_refresh()
    personal = driver._get_personal_details_pane()

    failures = 0
    for code in ("M", "F", "M"):
        if driver._select_sex_by_typing(personal, code):
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

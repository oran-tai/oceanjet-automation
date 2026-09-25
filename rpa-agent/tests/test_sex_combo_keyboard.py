"""Manual check: Sex combo keyboard selection path

Exercises _select_combo_by_typing() directly on the Sex combo of the
Personal Details pane, on a fresh form. Selects M, then F, then M again,
reading the combo back after each. This is the fallback added Sept 25, 2026
after a booking failed with RPA_INTERNAL_ERROR: pywinauto's select() and the
physical-open enumeration both saw no list items while the Sex list was
visibly dropped.

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
    logger.info("TEST: Sex combo keyboard selection (M -> F -> M)")
    logger.info("=" * 60)

    driver = PrimeDriver()
    driver.click_refresh()
    personal = driver._get_personal_details_pane()

    def combo():
        return personal.children(control_type="ComboBox")[0]

    failures = 0
    for code in ("M", "F", "M"):
        def verify(source, strict=False, code=code):
            actual = driver._read_combo_value(combo())
            ok = actual.strip().upper() == code
            logger.info(f"Sex reads '{actual}' after {source}, expected '{code}' -> {'ok' if ok else 'MISMATCH'}")
            return ok

        if driver._select_combo_by_typing(combo, code, "sex", verify):
            logger.info(f"PASS: '{code}' selected and verified via keyboard")
        else:
            logger.error(f"FAIL: '{code}' not verified via keyboard")
            driver._save_debug_screenshot(f"sex_keyboard_{code}")
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

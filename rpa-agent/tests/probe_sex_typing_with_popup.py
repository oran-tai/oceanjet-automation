"""Probe: what the Sex typed select does while a sold-out popup blocks the form

Since Nov 26, 2026 the Sex combo is typed first and the list select is the
fallback. The list select is also what trips over a sold-out popup (COMError
-> _check_sold_out_after_voyage). This probe answers, on a real sold-out
voyage, whether the typed path notices the popup or passes silently when the
combo already shows the wanted letter.

Steps:
1. Types STALE_SEX into the Sex combo, clicks Refresh and reads the combo
   back (does Refresh keep the previous passenger's Sex?).
2. Fills Trip Details for the sold-out voyage (production path).
3. Looks for the small PRIME popup. Without one there is nothing to probe.
4. With the popup up, logs the outcome of each call the typed path makes:
   read value, read buttons, set_focus, type the same letter, read back.
5. Runs _select_sex_by_typing() for the same letter, then the other letter.
6. Runs the list select (_select_combo_verified, propagate_comerror=True)
   and logs whether it raises COMError, as production relies on.
7. Looks up the Issue button (lookup only).
8. Cleanup: _dismiss_error_popup() + Refresh.

Issue is never clicked. No ticket is issued. Run on the VM with PRIME open on
Issue New Ticket and the automation stopped on that VM:
    py tests/probe_sex_typing_with_popup.py
    py tests/probe_sex_typing_with_popup.py CEB TAG "2:00 PM" BC "Thu, Nov 26th 2026"

Arguments (all optional, positional): origin, destination, departure time,
accommodation code that is sold out, date.
"""

import logging
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("probe-sex-popup")

ORIGIN = sys.argv[1] if len(sys.argv) > 1 else "CEB"
DESTINATION = sys.argv[2] if len(sys.argv) > 2 else "TAG"
TIME = sys.argv[3] if len(sys.argv) > 3 else "2:00 PM"
CODE = (sys.argv[4] if len(sys.argv) > 4 else "BC").upper()
DATE = sys.argv[5] if len(sys.argv) > 5 else "Thu, Nov 26th 2026"

STALE_SEX = "F"
OTHER_SEX = "M"


def find_popup():
    """The small PRIME-titled window, same lookup as _check_sold_out_after_voyage."""
    from pywinauto import Desktop

    try:
        for w in Desktop(backend="uia").windows(title_re="OCEAN FAST FERRIES.*"):
            rect = w.rectangle()
            if rect.right - rect.left < 700:
                return w
    except Exception as e:
        logger.warning(f"Popup lookup failed ({type(e).__name__}: {e})")
    return None


def step(name, fn):
    """Run one call, log its result or the exception type, never raise."""
    try:
        value = fn()
        logger.info(f"RESULT {name}: ok -> {value!r}")
        return value
    except Exception as e:
        logger.info(f"RESULT {name}: RAISED {type(e).__name__}: {e}")
        return None


def main():
    from pywinauto.keyboard import send_keys

    from agent.error_codes import TicketErrorCode
    from agent.prime_driver import PrimeDriver

    leg = {
        "origin": ORIGIN,
        "destination": DESTINATION,
        "date": DATE,
        "time": TIME,
        "accommodation": CODE,
    }

    logger.info("=" * 60)
    logger.info(f"PROBE: Sex typing with a popup up ({ORIGIN}->{DESTINATION} {DATE} {TIME} {CODE})")
    logger.info("=" * 60)

    driver = PrimeDriver()

    def personal():
        return driver._get_personal_details_pane()

    def combo():
        return personal().children(control_type="ComboBox")[0]

    # 1. Leave a stale Sex value, as the previous passenger would
    logger.info("")
    logger.info(f"--- 1. Stale value: type '{STALE_SEX}', Refresh, read back ---")
    driver.click_refresh()
    typed = driver._select_sex_by_typing(personal(), STALE_SEX)
    logger.info(f"RESULT typed '{STALE_SEX}' on a clean form: {typed}")
    driver.click_refresh()
    after_refresh = step("Sex value after Refresh", lambda: driver._read_combo_value(combo()))
    if (after_refresh or "").strip().upper() != STALE_SEX:
        logger.info("NOTE: Refresh did not keep the Sex value; the same-letter case starts from this value instead")

    # 2. Sold-out voyage
    logger.info("")
    logger.info("--- 2. Fill Trip Details for the sold-out voyage ---")
    step("fill_trip_details", lambda: driver.fill_trip_details(leg, "One Way"))
    time.sleep(1)

    # 3. Is a popup up?
    logger.info("")
    logger.info("--- 3. Popup check ---")
    popup = find_popup()
    if popup is None:
        logger.error("NO POPUP after the trip fill. This voyage does not block the form at this stage;")
        logger.error("the probe cannot answer the question. Refreshing and stopping.")
        driver._save_debug_screenshot("probe_sex_popup_none")
        driver.click_refresh()
        sys.exit(1)
    logger.info(f"RESULT popup present: title={popup.window_text()!r} rect={popup.rectangle()}")
    driver._save_debug_screenshot("probe_sex_popup_up")

    # 4. Each call of the typed path, one at a time
    logger.info("")
    logger.info("--- 4. Typed-path calls with the popup up ---")
    before = step("read Sex value", lambda: driver._read_combo_value(combo()))
    step("read 'Close' button", lambda: len(combo().children(title="Close", control_type="Button")))
    step("set_focus()", lambda: combo().set_focus() and None)
    time.sleep(0.2)
    same = (before or STALE_SEX).strip().upper() or STALE_SEX
    step(f"send_keys('{same}')", lambda: send_keys(same))
    time.sleep(0.4)
    step("read Sex value after typing", lambda: driver._read_combo_value(combo()))
    logger.info(f"RESULT popup still present after typing: {find_popup() is not None}")

    # 5. The production typed select
    logger.info("")
    logger.info("--- 5. _select_sex_by_typing with the popup up ---")
    other = OTHER_SEX if same == STALE_SEX else STALE_SEX
    same_result = step(
        f"_select_sex_by_typing('{same}') [combo already reads it]",
        lambda: driver._select_sex_by_typing(personal(), same),
    )
    other_result = step(
        f"_select_sex_by_typing('{other}') [combo reads the other letter]",
        lambda: driver._select_sex_by_typing(personal(), other),
    )
    logger.info(f"RESULT popup still present: {find_popup() is not None}")

    # 6. The list select production falls back to
    logger.info("")
    logger.info("--- 6. List select with the popup up (production expects COMError) ---")
    step(
        "_select_combo_verified(sex)",
        lambda: driver._select_combo_verified(
            personal(), 0, same, "sex",
            TicketErrorCode.PASSENGER_VALIDATION_ERROR,
            propagate_comerror=True,
        ),
    )
    logger.info(f"RESULT popup still present: {find_popup() is not None}")

    # 7. Issue button lookup only, never clicked
    logger.info("")
    logger.info("--- 7. Issue button lookup (not clicked) ---")
    step(
        "Issue button rectangle",
        lambda: driver.main_window.child_window(
            title_re=" *Issue", control_type="Button"
        ).rectangle(),
    )

    # 8. Cleanup, same as production
    logger.info("")
    logger.info("--- 8. Cleanup ---")
    step("_dismiss_error_popup", driver._dismiss_error_popup)
    step("click_refresh", driver.click_refresh)
    step("_dismiss_error_popup (after Refresh)", driver._dismiss_error_popup)
    logger.info(f"RESULT popup still present after cleanup: {find_popup() is not None}")

    logger.info("")
    logger.info("=" * 60)
    logger.info("SUMMARY")
    logger.info(f"  Sex after Refresh: {after_refresh!r} (typed '{STALE_SEX}' before Refresh)")
    logger.info(f"  typed select, same letter, popup up:  {same_result}")
    logger.info(f"  typed select, other letter, popup up: {other_result}")
    if same_result is True:
        logger.info("  => SILENT CASE CONFIRMED: the typed select passes with a popup blocking the form")
    else:
        logger.info("  => The typed select fails with a popup up; the list select and sold-out check still run")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

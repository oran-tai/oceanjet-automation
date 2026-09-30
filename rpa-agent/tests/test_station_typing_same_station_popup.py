"""VM check: station keyboard fallback vs the same-station popup

Sept 30, 2026 (booking 6abd20ae..., leg 1 SUR->MAA): after Refresh the form
still held the previous booking's stations with Destination = SIQ. The
Origin list would not enumerate, so _select_station_by_typing typed 'SUR'
into the Origin edit. Both read-backs returned 'SIQ', the booking failed with
RPA_INTERNAL_ERROR, and only the cleanup classifier found the popup
'Origin and Destination must not be the same.' sitting on the form.

The first run of this script (Sept 30, 17:34) pinned both mechanisms:
  A. Typing 'S' auto-completes the combo to 'SIQ' (first station starting
     with S), PRIME validates on change, sees Origin == Destination, and the
     modal popup eats 'U','R'. Dismissing it mid-word and continuing gives
     'SIQUR' because the auto-complete selection is lost.
  B. With the popup already up, the production fallback typed into the
     popup and read 'SIQ' back twice.

The fallback now dismisses a popup before typing and, on a mid-word
collision, dismisses it and steps the combo with arrow keys to the code.
This script drives the production fallback through both cases and fails
if any read-back misses:

  Phase 1  setup by typing char by char (Origin TAG, Destination SIQ),
           logging combo value + popup state after every keystroke.
  Phase 2  cause A on Origin: fallback 'SUR' with Destination = SIQ.
  Phase 3  cause B: provoke the popup, leave it open, fallback 'SUR'.
  Phase 4  cause A on Destination: Origin SIQ, fallback 'SUR' into
           Destination (its first keystroke collides with Origin).

No ticket is issued; no Enter is ever sent to the form. Ends with Refresh.
Run on the VM with PRIME open on Issue New Ticket:
    py tests/test_station_typing_same_station_popup.py
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
logger = logging.getLogger("test-same-station-popup")

ORIGIN_INDEX = 2       # ComboBox index within Trip Details
DESTINATION_INDEX = 1

driver = None
trip_details = None
failures = []


def combo(index):
    return trip_details.children(control_type="ComboBox")[index]


def read(index) -> str:
    try:
        return driver._read_combo_value(combo(index))
    except Exception as e:
        return f"<unreadable: {e}>"


def popup_state() -> str:
    """Describe any PRIME popup currently visible, or 'none'."""
    from pywinauto import Desktop

    try:
        dlg = driver.main_window.child_window(
            title_re=".*OCEAN FAST FERRIES.*", control_type="Window"
        )
        if dlg.exists(timeout=0.3):
            texts = []
            try:
                texts = [c.window_text() for c in dlg.descendants(control_type="Text")]
            except Exception:
                pass
            return f"child dialog (texts={texts[:4]})"
    except Exception as e:
        logger.debug(f"child dialog check failed: {e}")

    try:
        for w in Desktop(backend="uia").windows(title_re="OCEAN FAST FERRIES.*"):
            try:
                rect = w.rectangle()
            except Exception:
                continue
            if (rect.right - rect.left) < 700:
                return f"top-level window {rect.right - rect.left}px wide"
    except Exception as e:
        logger.debug(f"top-level check failed: {e}")

    return "none"


def dismiss_popup() -> bool:
    before = popup_state()
    if before == "none":
        return False
    driver._dismiss_same_station_dialog()
    time.sleep(0.5)
    after = popup_state()
    logger.info(f"    dismiss: before='{before}' after='{after}'")
    if after != "none":
        logger.warning("    same-station dismiss left the popup up; using _dismiss_error_popup()")
        driver._dismiss_error_popup()
        time.sleep(0.5)
        logger.info(f"    after error dismiss: '{popup_state()}'")
    return True


def type_chars(index: int, code: str, role: str) -> str:
    """Type `code` char by char, logging read-back and popup state after each.

    Setup helper only. A popup that appears mid-typing is dismissed and the
    remaining characters are still sent, so the log shows what lands.
    """
    from pywinauto.keyboard import send_keys

    logger.info(f"--- typing '{code}' into {role} (index {index}) char by char ---")
    logger.info(f"    start: {role} reads '{read(index)}', popup='{popup_state()}'")

    c = combo(index)
    if c.children(title="Close", control_type="Button"):
        logger.info("    list was dropped; sending Escape")
        send_keys("{ESC}")
        time.sleep(0.3)
        c = combo(index)
    edits = c.children(control_type="Edit")
    if not edits:
        logger.error(f"    {role} combo has no Edit child; cannot type")
        return read(index)
    edits[0].click_input()
    time.sleep(0.2)
    send_keys("{HOME}+{END}")
    time.sleep(0.2)

    for i, ch in enumerate(code, start=1):
        send_keys(ch)
        time.sleep(0.5)
        logger.info(f"    after '{code[:i]}': {role} reads '{read(index)}', popup='{popup_state()}'")
        if dismiss_popup():
            try:
                combo(index).children(control_type="Edit")[0].click_input()
                time.sleep(0.2)
            except Exception as e:
                logger.warning(f"    could not re-focus edit after dismiss: {e}")

    final = read(index)
    logger.info(f"    final: {role} reads '{final}', popup='{popup_state()}'")
    return final


def check(phase: str, index: int, code: str, role: str):
    """Run the production fallback and record pass/fail."""
    ok = driver._select_station_by_typing(trip_details, index, code, role)
    value = read(index)
    state = popup_state()
    origin, dest = read(ORIGIN_INDEX), read(DESTINATION_INDEX)
    logger.info(f"{phase}: fallback('{code}') -> {ok}; {role} reads '{value}', "
                f"popup='{state}'; form origin='{origin}' destination='{dest}'")
    if ok and value.strip().upper() == code.upper() and state == "none":
        logger.info(f"{phase}: PASS")
    else:
        logger.error(f"{phase}: FAIL")
        failures.append(f"{phase}: returned {ok}, {role}='{value}', popup='{state}'")
        dismiss_popup()


def main():
    global driver, trip_details
    from agent.prime_driver import PrimeDriver

    logger.info("=" * 60)
    logger.info("TEST: station typing fallback vs same-station popup")
    logger.info("=" * 60)

    driver = PrimeDriver()
    driver.click_refresh()
    trip_details = driver._get_trip_details_pane()

    logger.info(f"After Refresh: origin='{read(ORIGIN_INDEX)}' "
                f"destination='{read(DESTINATION_INDEX)}' popup='{popup_state()}'")
    dismiss_popup()

    # ---- Phase 1: set up Origin TAG, Destination SIQ -------------------
    logger.info("")
    logger.info("=== Phase 1: set up Origin=TAG, Destination=SIQ (char by char) ===")
    origin = type_chars(ORIGIN_INDEX, "TAG", "origin")
    dismiss_popup()
    dest = type_chars(DESTINATION_INDEX, "SIQ", "destination")
    dismiss_popup()
    logger.info(f"Setup result: origin='{origin}' destination='{dest}'")
    if origin.strip().upper() != "TAG" or dest.strip().upper() != "SIQ":
        logger.error("Setup did not land; later phases are inconclusive")
        failures.append(f"setup: origin='{origin}' destination='{dest}'")

    # ---- Phase 2: cause A on Origin -------------------------------------
    logger.info("")
    logger.info("=== Phase 2: fallback 'SUR' into Origin while Destination='SIQ' ===")
    logger.info("Expected: 'S' collides with SIQ, popup dismissed, arrows step to SUR")
    check("Phase 2", ORIGIN_INDEX, "SUR", "origin")

    # ---- Phase 3: cause B, popup already up ------------------------------
    logger.info("")
    logger.info("=== Phase 3: popup already open, then fallback 'SUR' into Origin ===")
    type_chars(ORIGIN_INDEX, "S", "origin")   # auto-completes to SIQ == destination
    # type_chars dismissed it; provoke once more and leave it open
    from pywinauto.keyboard import send_keys
    combo(ORIGIN_INDEX).children(control_type="Edit")[0].click_input()
    time.sleep(0.2)
    send_keys("{HOME}+{END}")
    send_keys("T")
    time.sleep(0.5)
    send_keys("{HOME}+{END}")
    send_keys("S")
    time.sleep(0.5)
    state = popup_state()
    logger.info(f"Popup before fallback: '{state}'; origin reads '{read(ORIGIN_INDEX)}'")
    if state == "none":
        logger.warning("Could not provoke the popup; Phase 3 is inconclusive")
        failures.append("Phase 3: popup could not be provoked")
    else:
        check("Phase 3", ORIGIN_INDEX, "SUR", "origin")

    # ---- Phase 4: cause A on Destination ---------------------------------
    logger.info("")
    logger.info("=== Phase 4: Origin=SIQ, then fallback 'SUR' into Destination ===")
    logger.info("Expected: destination 'S' collides with Origin SIQ, arrows step to SUR")
    # Origin currently SUR, Destination SIQ. Set Destination to TAG first so
    # Origin can become SIQ without a collision, then Destination 'SUR'
    # collides with Origin on its first keystroke.
    check("Phase 4 setup (destination TAG)", DESTINATION_INDEX, "TAG", "destination")
    check("Phase 4 setup (origin SIQ)", ORIGIN_INDEX, "SIQ", "origin")
    check("Phase 4", DESTINATION_INDEX, "SUR", "destination")

    # ---- Cleanup --------------------------------------------------------
    logger.info("")
    logger.info("=== Cleanup ===")
    dismiss_popup()
    driver.click_refresh()
    time.sleep(0.5)
    dismiss_popup()
    logger.info(f"After cleanup Refresh: origin='{read(ORIGIN_INDEX)}' "
                f"destination='{read(DESTINATION_INDEX)}' popup='{popup_state()}'")

    logger.info("")
    logger.info("=" * 60)
    if failures:
        logger.error(f"TEST FAILED ({len(failures)} checks)")
        for f in failures:
            logger.error(f"  - {f}")
        logger.info("=" * 60)
        sys.exit(1)
    logger.info("TEST PASSED")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

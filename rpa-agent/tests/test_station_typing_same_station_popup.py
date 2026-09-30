"""Repro: station keyboard fallback vs the same-station popup

Sept 30, 2026 (booking 6abd20ae..., leg 1 SUR->MAA): after Refresh the form
still held the previous booking's stations with Destination = SIQ. The
Origin list would not enumerate, so _select_station_by_typing typed 'SUR'
into the Origin edit. Both read-backs returned 'SIQ', the booking failed with
RPA_INTERNAL_ERROR, and only the cleanup classifier found the popup
'Origin and Destination must not be the same.' sitting on the form.

Two candidate causes, and this script tells them apart:

  A. The popup fires mid-typing. 'S' auto-completes the editable combo to
     'SIQ' (first station starting with S), PRIME validates on change, sees
     Origin == Destination, raises the modal popup, and 'U','R' are eaten.
  B. The popup was already up before typing, and the fallback never checks
     for it, so every keystroke lands on the popup.

Phase 1 sets the form up (Origin TAG, Destination SIQ), typing char by char
and logging the combo value and popup state after every keystroke.
Phase 2 types 'SUR' into Origin char by char with Destination = SIQ. If the
popup appears after 'S', cause A is confirmed; the script dismisses it and
keeps typing so we also learn whether the remaining keystrokes then land.
Phase 3 provokes the popup on purpose, leaves it open, and calls the
production fallback exactly as the driver does, to confirm cause B fails
the same way the log did.

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
findings = []


def combo(index):
    return trip_details.children(control_type="ComboBox")[index]


def read(index) -> str:
    try:
        return driver._read_combo_value(combo(index))
    except Exception as e:
        return f"<unreadable: {e}>"


def popup_state() -> str:
    """Describe any PRIME popup currently visible, or 'none'.

    Checks both shapes _dismiss_error_popup() knows about: a child dialog
    of the main window, and a small top-level 'OCEAN FAST FERRIES' window.
    """
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
    """Dismiss the same-station dialog the way fill_trip_details does."""
    before = popup_state()
    if before == "none":
        return False
    driver._dismiss_same_station_dialog()
    time.sleep(0.5)
    after = popup_state()
    logger.info(f"    dismiss: before='{before}' after='{after}'")
    if after != "none":
        # Same-station helper only knows the child-dialog shape; fall back
        # to the popup-aware error dismiss (classifies via Gemini first).
        logger.warning("    same-station dismiss left the popup up; using _dismiss_error_popup()")
        driver._dismiss_error_popup()
        time.sleep(0.5)
        logger.info(f"    after error dismiss: '{popup_state()}'")
    return True


def type_chars(index: int, code: str, role: str, dismiss_between: bool) -> str:
    """Type `code` into the combo's Edit child one character at a time.

    After every keystroke, logs the combo read-back and popup state. With
    dismiss_between=True, a popup that appears mid-typing is dismissed
    before the next character (so we learn whether later keys still land).
    Mirrors _select_station_by_typing: Escape a dropped list, click the
    Edit child, Home/Shift+End, then the characters. Never Enter or Tab.
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
    logger.info(f"    after select-all: {role} reads '{read(index)}', popup='{popup_state()}'")

    for i, ch in enumerate(code, start=1):
        send_keys(ch)
        time.sleep(0.5)
        value = read(index)
        state = popup_state()
        logger.info(f"    after '{code[:i]}': {role} reads '{value}', popup='{state}'")
        if state != "none":
            findings.append(
                f"{role}: popup appeared after typing '{code[:i]}' "
                f"(combo read '{value}', other combo read "
                f"'{read(DESTINATION_INDEX if index == ORIGIN_INDEX else ORIGIN_INDEX)}')"
            )
            if dismiss_between:
                dismiss_popup()
                # Re-focus the edit; the popup took focus
                try:
                    combo(index).children(control_type="Edit")[0].click_input()
                    time.sleep(0.2)
                except Exception as e:
                    logger.warning(f"    could not re-focus edit after dismiss: {e}")

    final = read(index)
    logger.info(f"    final: {role} reads '{final}', popup='{popup_state()}'")
    return final


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
    logger.info("=== Phase 1: set up Origin=TAG, Destination=SIQ ===")
    origin = type_chars(ORIGIN_INDEX, "TAG", "origin", dismiss_between=True)
    dismiss_popup()
    dest = type_chars(DESTINATION_INDEX, "SIQ", "destination", dismiss_between=True)
    dismiss_popup()
    logger.info(f"Setup result: origin='{origin}' destination='{dest}'")
    if origin.strip().upper() != "TAG" or dest.strip().upper() != "SIQ":
        logger.error("Setup did not land; Phase 2/3 results will be inconclusive. "
                     "Read the per-keystroke lines above.")
        findings.append(f"setup failed: origin='{origin}' destination='{dest}'")

    # ---- Phase 2: type SUR into Origin with Destination = SIQ ----------
    logger.info("")
    logger.info("=== Phase 2: type 'SUR' into Origin while Destination='SIQ' ===")
    logger.info("Cause A predicts: after 'S' origin reads 'SIQ' and a popup is up.")
    before = len(findings)
    final = type_chars(ORIGIN_INDEX, "SUR", "origin", dismiss_between=True)
    if len(findings) > before:
        logger.info("Phase 2: popup DID appear mid-typing (cause A)")
    else:
        logger.info("Phase 2: no popup appeared mid-typing")
    logger.info(f"Phase 2 final origin='{final}' "
                f"({'landed' if final.strip().upper() == 'SUR' else 'DID NOT land'})")
    findings.append(f"phase 2: origin after typing SUR with popups dismissed between keys = '{final}'")
    dismiss_popup()

    # ---- Phase 3: popup already up, then the production fallback -------
    logger.info("")
    logger.info("=== Phase 3: provoke the popup, leave it open, run the production fallback ===")
    # Origin currently SUR (or whatever landed); typing SIQ into Origin with
    # Destination = SIQ should raise the same-station popup. Leave it open.
    type_chars(ORIGIN_INDEX, "SIQ", "origin", dismiss_between=False)
    state = popup_state()
    logger.info(f"Popup before production fallback: '{state}'")
    if state == "none":
        logger.warning("Could not provoke the popup; Phase 3 is inconclusive")
        findings.append("phase 3: popup could not be provoked")
    else:
        ok = driver._select_station_by_typing(trip_details, ORIGIN_INDEX, "SUR", "origin")
        logger.info(f"_select_station_by_typing('SUR') with popup open -> {ok}; "
                    f"origin reads '{read(ORIGIN_INDEX)}', popup='{popup_state()}'")
        findings.append(
            f"phase 3: production fallback with popup already open returned {ok}, "
            f"origin='{read(ORIGIN_INDEX)}', popup after='{popup_state()}'"
        )

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
    logger.info("FINDINGS")
    for f in findings:
        logger.info(f"  - {f}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

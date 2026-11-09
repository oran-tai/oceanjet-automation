"""Probe: can the RPA read Fare / Total Due from PRIME's Rates pane?

Price check feature (Nov 2026): before issuing a ticket we want to compare
PRIME's Total Due per passenger against Bookaway's supplier cost (Bookaway
carries OceanJet's fare minus the 5% agreement discount, e.g. PRIME 1,450.00
BC vs Bookaway 1,377.50 PHP). PRIME only fills the Rates pane (Fare, Discount,
Terminal Fee, Total Due) after Issue is clicked, at the same moment the
'Confirm' popup appears. Accessibility Insights shows the Rates pane with
only three UIA children (button 'Reset', an empty edit, pane 'Promo /
Discounts'), so the numbers may be non-windowed Delphi labels UIA cannot see.

This script answers that empirically. It fills a real voyage and one test
passenger (the production path), then at three moments dumps everything the
UIA backend, the LegacyIAccessible pattern and the Win32 backend can see in
the Rates pane, and scans the whole main window for money-shaped text:

    1. before Issue           (pane expected empty / zeros)
    2. Confirm popup OPEN     (option A: read while the popup is up)
    3. after clicking No      (option B: read after closing the popup)

A full-screen screenshot is saved at each moment under debug/ so the Gemini
fallback (option C) can be prototyped from the same run.

NO TICKET IS ISSUED: the Confirm popup is always answered No. Run on the VM
with PRIME open on Issue New Ticket and the automation stopped:
    py tests/probe_rates_pane_readability.py
    py tests/probe_rates_pane_readability.py CEB TAG "6:00 AM" BC

Arguments (all optional, positional): origin, destination, departure time,
accommodation code. The date is 3 days from today.

Read the summary at the end: for each moment it says whether money-shaped
text (e.g. 1,450.00) was found and through which backend/element.
"""

import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("probe-rates")

ORIGIN = sys.argv[1] if len(sys.argv) > 1 else "CEB"
DESTINATION = sys.argv[2] if len(sys.argv) > 2 else "TAG"
TIME = sys.argv[3] if len(sys.argv) > 3 else "6:00 AM"
ACCOMMODATION = (sys.argv[4] if len(sys.argv) > 4 else "TC").upper()

TEST_PASSENGER = {
    "firstName": "PRICEPROBE",
    "lastName": "DONOTISSUE",
    "age": "30",
    "gender": "Male",
}
TEST_CONTACT = "price-probe@bookaway.com"

# 1,450.00 / 912.00 / 0.00 / -0.00 — PRIME prints two decimals everywhere
MONEY_RE = re.compile(r"-?\s?\d{1,3}(?:,\d{3})*\.\d{2}\b")
CONFIRM_WAIT_SEC = 30

findings = {}  # phase -> list of (source, text)


def _safe(fn, default=""):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 — a probe must never die on one element
        return f"<{type(e).__name__}>" if default == "" else default


def _legacy(elem):
    """LegacyIAccessible name/value/description, or '' when unsupported."""
    try:
        pat = elem.element_info.element.GetCurrentPattern(10018)  # UIA_LegacyIAccessiblePatternId
        if not pat:
            return {}
        from comtypes.gen import UIAutomationClient as uia
        leg = pat.QueryInterface(uia.IUIAutomationLegacyIAccessiblePattern)
        return {
            "name": leg.CurrentName or "",
            "value": leg.CurrentValue or "",
            "description": leg.CurrentDescription or "",
        }
    except Exception as e:  # noqa: BLE001
        return {"error": type(e).__name__}


def _record(phase, source, text):
    text = (text or "").strip()
    if text and MONEY_RE.search(text):
        findings.setdefault(phase, []).append((source, text))


def dump_rates_pane_uia(driver, phase):
    """Everything the UIA backend exposes under pane ' Rates '."""
    logger.info(f"[{phase}] --- UIA: Rates pane ---")
    try:
        rates = driver.main_window.child_window(title_re=" *Rates *", control_type="Pane")
        rates.wait("exists", timeout=3)
    except Exception as e:  # noqa: BLE001
        logger.error(f"[{phase}] Rates pane not found via UIA: {e!r}")
        return
    own = _legacy(rates)
    logger.info(f"[{phase}] pane legacy={own} text='{_safe(rates.window_text)}'")
    _record(phase, "uia:rates-pane.legacy", str(own))
    try:
        descendants = rates.descendants()
    except Exception as e:  # noqa: BLE001
        logger.error(f"[{phase}] rates.descendants() raised {e!r}")
        descendants = []
    logger.info(f"[{phase}] {len(descendants)} UIA descendants")
    for i, d in enumerate(descendants):
        ct = _safe(lambda: d.element_info.control_type)
        name = _safe(d.window_text)
        cls = _safe(lambda: d.element_info.class_name)
        rect = _safe(lambda: str(d.rectangle()))
        value = ""
        try:
            if hasattr(d, "get_value"):
                value = d.get_value()
        except Exception:  # noqa: BLE001
            pass
        leg = _legacy(d)
        logger.info(
            f"[{phase}]   #{i} {ct} class={cls} name='{name}' value='{value}' "
            f"legacy={leg} rect={rect}"
        )
        _record(phase, f"uia:#{i}:{ct}:name", name)
        _record(phase, f"uia:#{i}:{ct}:value", str(value))
        _record(phase, f"uia:#{i}:{ct}:legacy", str(leg))


def dump_rates_region_win32(driver, phase):
    """Windowed controls inside the Rates pane's rectangle, via the Win32 backend.

    Delphi TLabel is non-windowed (invisible to both backends); TStaticText /
    TPanel / TEdit are windowed and carry WM_GETTEXT, which Win32 reads even
    when the UIA tree omits them.
    """
    logger.info(f"[{phase}] --- Win32: controls inside the Rates rectangle ---")
    try:
        from pywinauto import Desktop
        rates = driver.main_window.child_window(title_re=" *Rates *", control_type="Pane")
        rr = rates.rectangle()
        main32 = Desktop(backend="win32").window(handle=driver.main_window.handle)
        ctrls = main32.descendants()
    except Exception as e:  # noqa: BLE001
        logger.error(f"[{phase}] win32 enumeration failed: {e!r}")
        return
    inside = 0
    for c in ctrls:
        try:
            r = c.rectangle()
            if r.left < rr.left or r.right > rr.right or r.top < rr.top or r.bottom > rr.bottom:
                continue
            inside += 1
            text = c.window_text()
            logger.info(
                f"[{phase}]   hwnd={c.handle} class={c.class_name()} "
                f"text='{text}' rect={r}"
            )
            _record(phase, f"win32:{c.class_name()}:{c.handle}", text)
        except Exception:  # noqa: BLE001
            continue
    logger.info(f"[{phase}] {inside} win32 controls inside the Rates rectangle")


def scan_main_window_for_money(driver, phase):
    """Any UIA element anywhere in the main window whose name/value looks like money."""
    logger.info(f"[{phase}] --- UIA: money-shaped text anywhere in the main window ---")
    try:
        elems = driver.main_window.descendants()
    except Exception as e:  # noqa: BLE001
        logger.error(f"[{phase}] main_window.descendants() raised {e!r}")
        return
    hits = 0
    for e in elems:
        name = _safe(e.window_text)
        value = ""
        try:
            if hasattr(e, "get_value"):
                value = e.get_value()
        except Exception:  # noqa: BLE001
            pass
        for label, txt in (("name", name), ("value", str(value))):
            if txt and MONEY_RE.search(txt):
                hits += 1
                ct = _safe(lambda: e.element_info.control_type)
                logger.info(f"[{phase}]   {ct} {label}='{txt}' rect={_safe(lambda: str(e.rectangle()))}")
                _record(phase, f"uia:main-window:{ct}:{label}", txt)
    logger.info(f"[{phase}] {hits} money-shaped UIA texts in {len(elems)} elements")


def snapshot(driver, phase):
    driver._save_debug_screenshot(f"rates_probe_{phase}")
    dump_rates_pane_uia(driver, phase)
    dump_rates_region_win32(driver, phase)
    scan_main_window_for_money(driver, phase)


def wait_for_confirm():
    from pywinauto import Desktop
    desktop = Desktop(backend="uia")
    deadline = time.time() + CONFIRM_WAIT_SEC
    while time.time() < deadline:
        try:
            dlg = desktop.window(title="Confirm")
            if dlg.exists(timeout=0.1):
                return dlg, None
        except Exception:  # noqa: BLE001
            pass
        try:
            for w in desktop.windows(title_re="OCEAN FAST FERRIES.*"):
                r = w.rectangle()
                if r.right - r.left < 700:
                    return None, w
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.5)
    return None, None


def main():
    from pywinauto.keyboard import send_keys
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import PrimeError

    leg = {
        "origin": ORIGIN,
        "destination": DESTINATION,
        "date": (datetime.now() + timedelta(days=3)).strftime("%a, %b %d %Y"),
        "time": TIME,
        "accommodation": ACCOMMODATION,
    }

    logger.info("=" * 60)
    logger.info(
        f"PROBE: Rates pane readability "
        f"({ORIGIN}->{DESTINATION} {leg['date']} {TIME} {ACCOMMODATION})"
    )
    logger.info("=" * 60)

    driver = PrimeDriver()
    driver.click_refresh()

    # 1. Production path: trip + one passenger, no Issue yet
    logger.info("--- Filling trip details + test passenger (production path) ---")
    try:
        driver.fill_trip_details(leg, "One Way")
        driver.fill_personal_details(TEST_PASSENGER, TEST_CONTACT)
    except PrimeError as e:
        logger.error(f"FAIL: form did not fill: [{e.error_code.value}] {e}")
        driver._dismiss_error_popup()
        driver.click_refresh()
        sys.exit(1)
    snapshot(driver, "1_before_issue")

    # 2. Issue -> Confirm popup open. Rates pane should now show the fare.
    logger.info("--- Clicking Issue (will answer No) ---")
    driver.click_issue()
    confirm, error_dlg = wait_for_confirm()
    if confirm is None:
        if error_dlg is not None:
            logger.error(
                f"No Confirm popup; PRIME raised a dialog instead "
                f"(title='{_safe(error_dlg.window_text)}'). Dismissing and stopping."
            )
        else:
            logger.error(f"No Confirm popup within {CONFIRM_WAIT_SEC}s. Stopping.")
        driver._save_debug_screenshot("rates_probe_no_confirm")
        driver._dismiss_error_popup()
        driver.click_refresh()
        sys.exit(1)
    logger.info("Confirm popup is open; reading Rates pane NOW")
    time.sleep(1.0)  # let PRIME finish painting the pane
    snapshot(driver, "2_popup_open")

    # 3. Close the popup with No (never Yes) and read again
    logger.info("--- Clicking No on the Confirm popup ---")
    try:
        confirm.child_window(title="No", control_type="Button").click_input()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"No button click failed ({e!r}); pressing Escape")
        send_keys("{ESC}")
    time.sleep(1.5)
    try:
        if confirm.exists(timeout=0.5):
            logger.error("Confirm popup is STILL open after No. Not touching it further.")
            driver._save_debug_screenshot("rates_probe_confirm_stuck")
            sys.exit(1)
    except Exception:  # noqa: BLE001
        pass
    snapshot(driver, "3_popup_closed")

    driver.click_refresh()

    # Summary
    logger.info("")
    logger.info("=" * 60)
    logger.info("SUMMARY — money-shaped text found per moment")
    for phase in ("1_before_issue", "2_popup_open", "3_popup_closed"):
        hits = findings.get(phase, [])
        verdict = "READABLE" if hits else "nothing readable"
        logger.info(f"{phase}: {verdict} ({len(hits)} hits)")
        for source, text in hits[:20]:
            logger.info(f"    {source} -> '{text}'")
    logger.info("Screenshots: debug/rates_probe_1_before_issue_*.png, "
                "debug/rates_probe_2_popup_open_*.png, debug/rates_probe_3_popup_closed_*.png")
    logger.info("Option A (read with popup open) = phase 2; option B (read after No) = phase 3; "
                "option C (Gemini) = run on the phase-2 screenshot.")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

"""Probe: what does pywinauto see under a dropped PRIME combo?

Three failures (accommodation Sept 23, Sex Sept 25, Origin Sept 26, 2026)
share one symptom: the combo's list is visibly dropped — the child button
reads 'Close' — yet pywinauto enumerates no List child and no ListItem
descendants, while Accessibility Insights on the same VM shows
combo box '' -> list '' -> list item ... . This script opens the Origin list
with the same click the driver uses and logs what each lookup returns, so
the gap can be pinned to a specific call rather than guessed at.

Read-only: opens the list, enumerates, presses Escape, clicks Refresh.
Run on the VM with PRIME open on Issue New Ticket:
    py tests/probe_combo_enumeration.py
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
logger = logging.getLogger("probe-combo")

ORIGIN_INDEX = 2


def describe(label, elems):
    try:
        names = [f"{e.element_info.control_type}:'{e.window_text()}'" for e in elems]
    except Exception as e:
        names = [f"<describe failed: {e}>"]
    logger.info(f"{label}: {len(elems)} -> {names[:12]}{' ...' if len(names) > 12 else ''}")


def main():
    from pywinauto import Desktop
    from pywinauto.keyboard import send_keys
    from pywinauto import findwindows
    from agent.prime_driver import PrimeDriver

    driver = PrimeDriver()
    driver.click_refresh()
    trip_details = driver._get_trip_details_pane()

    def combo():
        return trip_details.children(control_type="ComboBox")[ORIGIN_INDEX]

    c = combo()
    logger.info(f"Origin combo handle={c.handle} class={c.element_info.class_name} "
                f"framework={c.element_info.framework_id}")
    describe("closed: children()", c.children())

    open_btns = c.children(title="Open", control_type="Button")
    if not open_btns:
        logger.error("No 'Open' child button on the closed combo; aborting")
        return
    open_btns[0].click_input()

    for wait in (0.4, 1.0, 2.0):
        time.sleep(wait)
        c = combo()
        logger.info(f"--- {wait}s after Open click ---")
        describe("children()", c.children())
        describe("children(List)", c.children(control_type="List"))
        describe("descendants(ListItem)", c.descendants(control_type="ListItem"))
        lists = c.children(control_type="List")
        if lists:
            describe("List.children()", lists[0].children())
        try:
            logger.info(f"get_expand_state()={c.get_expand_state()}")
        except Exception as e:
            logger.info(f"get_expand_state() raised {e!r}")
        try:
            hwnds = findwindows.find_windows(class_name="ComboLBox")
            logger.info(f"win32 ComboLBox hwnds: {hwnds}")
            for h in hwnds:
                w = Desktop(backend="win32").window(handle=h).wrapper_object()
                logger.info(f"  hwnd={h} visible={w.is_visible()} "
                            f"rect={w.rectangle()} items={w.item_texts()[:8]}...")
        except Exception as e:
            logger.info(f"win32 ComboLBox scan raised {e!r}")
        try:
            top = [w for w in Desktop(backend="uia").windows()
                   if w.element_info.class_name == "ComboLBox"]
            logger.info(f"uia Desktop().windows() ComboLBox: {len(top)}")
        except Exception as e:
            logger.info(f"uia desktop scan raised {e!r}")

    send_keys("{ESC}")
    time.sleep(0.3)
    describe("after Escape: children()", combo().children())
    driver.click_refresh()
    logger.info("Probe done")


if __name__ == "__main__":
    main()

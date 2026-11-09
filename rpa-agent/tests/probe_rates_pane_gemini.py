"""Probe: read Fare / Total Due from PRIME's Rates pane with Gemini Vision.

Nov 9, 2026: probe_rates_pane_readability.py showed the Rates pane numbers
(Fare, Discount, Terminal Fee, Total Due) are non-windowed Delphi labels —
invisible to UIA, LegacyIAccessible and Win32 before Issue, with the Confirm
popup open, and after closing it. Option C is the only path: screenshot the
pane, OCR it with Gemini, validate against Bookaway.

Validation rule: Bookaway's per-passenger supplier cost (costInSupplierCurrency,
PHP) is PRIME's Total Due minus the 5% agreement discount, settled monthly
with finance and never shown in PRIME. So  PRIME Total Due x 0.95 == Bookaway
cost, to the centavo (e.g. BC CEB-TAG: PRIME 1,450.00, Bookaway 1,377.50).

Two modes:

OFFLINE — read a saved screenshot, no PRIME interaction (seconds):
    py tests\\probe_rates_pane_gemini.py --image debug\\rates_probe_2_popup_open_<ts>.png
    py tests\\probe_rates_pane_gemini.py --image <png> --bookaway-cost 1377.5
  Default crop is the Rates rectangle logged on the VM (842,86,1059,399);
  override with --rect L,T,R,B. Pass --no-crop to send the full screenshot.

LIVE — production fill, Issue, read with the popup open, No, read again:
    py tests\\probe_rates_pane_gemini.py --live
    py tests\\probe_rates_pane_gemini.py --live CEB TAG "6:00 AM" BC --bookaway-cost 1377.5
  Reads the pane at three moments (before Issue, popup open, after No) so we
  also learn whether Refresh clears the previous ticket's numbers. The Rates
  rectangle is taken from UIA at run time, not hard-coded.

NO TICKET IS ISSUED: the Confirm popup is always answered No. Each crop sent
to Gemini is saved under debug/rates_gemini_<phase>_<ts>.png.
"""

import argparse
import io
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("probe-rates-gemini")

DISCOUNT_RATE = 0.05  # OceanJet agreement discount, settled monthly off-system
TOLERANCE_PHP = 0.01
DEFAULT_RECT = (842, 86, 1059, 399)  # Rates pane on the VM, Nov 9 2026 run
CROP_MARGIN_PX = 6
UPSCALE = 2  # small pane, big digits: 2x helps OCR of the decimals
CONFIRM_WAIT_SEC = 30

TEST_PASSENGER = {
    "firstName": "PRICEPROBE",
    "lastName": "DONOTISSUE",
    "age": "30",
    "gender": "Male",
}
TEST_CONTACT = "price-probe@bookaway.com"

FIELDS = ("ACCOM", "TRIP", "FARE", "DISCOUNT", "TERMINAL_FEE", "TOTAL_DUE")

PROMPT = (
    "This image is the 'Rates' panel of a ferry ticketing desktop application "
    "(OceanJet PRIME). The panel shows, top to bottom: 'Accom Desc.' (a seat "
    "class code such as TC, BC or OA), 'Trip' (origin-destination such as "
    "CEB-TAG), a 'Charge to' box, 'Balance', 'Running Total Counter', then "
    "four money rows: 'Fare', 'Discount', 'Terminal Fee' and 'Total Due', "
    "each printed with two decimals (for example 1,450.00 or 0.00).\n\n"
    "Read the values exactly as printed. Do not compute, round or guess. "
    "If a row is blank or shows no number, leave that field empty. "
    "Ignore 'Balance' and 'Running Total Counter'.\n\n"
    "Return in this exact format and nothing else:\n"
    "ACCOM: <Accom Desc code or empty>\n"
    "TRIP: <Trip value or empty>\n"
    "FARE: <Fare as printed or empty>\n"
    "DISCOUNT: <Discount as printed or empty>\n"
    "TERMINAL_FEE: <Terminal Fee as printed or empty>\n"
    "TOTAL_DUE: <Total Due as printed or empty>"
)


# ---------------------------------------------------------------- parsing

def parse_money(text: str):
    """'1,450.00' -> 1450.0; '- 0.00' -> 0.0; '' / junk -> None."""
    if not text:
        return None
    m = re.search(r"-?\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|-?\s?\d+(?:\.\d{1,2})?", text)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", "").replace(" ", ""))
    except ValueError:
        return None


def parse_response(raw: str) -> dict:
    out = {f: "" for f in FIELDS}
    for line in raw.splitlines():
        line = line.strip()
        for f in FIELDS:
            if line.upper().startswith(f + ":"):
                out[f] = line[len(f) + 1:].strip()
    return out


def validate(total_due, bookaway_cost):
    """Apply the 5% rule. Returns (ok: bool|None, message)."""
    if total_due is None:
        return None, "Total Due not read"
    if bookaway_cost is None:
        return None, f"Total Due {total_due:,.2f} read; pass --bookaway-cost to validate"
    expected_prime = round(bookaway_cost / (1 - DISCOUNT_RATE), 2)
    implied_bookaway = round(total_due * (1 - DISCOUNT_RATE), 2)
    ok = abs(implied_bookaway - bookaway_cost) <= TOLERANCE_PHP
    return ok, (
        f"PRIME Total Due {total_due:,.2f} x {1 - DISCOUNT_RATE:.2f} = {implied_bookaway:,.2f} "
        f"vs Bookaway {bookaway_cost:,.2f} (expected PRIME {expected_prime:,.2f}) -> "
        f"{'MATCH' if ok else 'MISMATCH'}"
    )


# ---------------------------------------------------------------- imaging

def crop_and_scale(image, rect, no_crop=False):
    from PIL import Image
    if not no_crop and rect:
        l, t, r, b = rect
        image = image.crop((
            max(0, l - CROP_MARGIN_PX), max(0, t - CROP_MARGIN_PX),
            min(image.width, r + CROP_MARGIN_PX), min(image.height, b + CROP_MARGIN_PX),
        ))
    if UPSCALE > 1:
        image = image.resize((image.width * UPSCALE, image.height * UPSCALE), Image.LANCZOS)
    return image


def save_debug(image, phase) -> Path:
    debug_dir = Path("debug")
    debug_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    path = debug_dir / f"rates_gemini_{phase}_{ts}.png"
    image.save(path, format="PNG")
    return path


def to_png_bytes(image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def read_rates(image, phase, call_gemini, rect, no_crop, bookaway_cost) -> dict:
    """Crop, send to Gemini, parse, validate. Returns the parsed dict + verdict."""
    crop = crop_and_scale(image, rect, no_crop)
    path = save_debug(crop, phase)
    logger.info(f"[{phase}] crop {crop.width}x{crop.height}px saved: {path}")
    t0 = time.time()
    raw = call_gemini(PROMPT, to_png_bytes(crop))
    logger.info(f"[{phase}] Gemini answered in {time.time() - t0:.1f}s:\n{raw}")
    parsed = parse_response(raw)
    numbers = {f: parse_money(parsed[f]) for f in ("FARE", "DISCOUNT", "TERMINAL_FEE", "TOTAL_DUE")}
    logger.info(f"[{phase}] parsed: accom='{parsed['ACCOM']}' trip='{parsed['TRIP']}' {numbers}")
    ok, msg = validate(numbers["TOTAL_DUE"], bookaway_cost)
    logger.info(f"[{phase}] {msg}")
    return {"phase": phase, "raw": raw, "parsed": parsed, "numbers": numbers, "ok": ok, "msg": msg}


# ---------------------------------------------------------------- modes

def run_offline(args):
    from PIL import Image
    from google import genai
    from google.genai import types
    from agent.config import GEMINI_API_KEY

    client = genai.Client(api_key=GEMINI_API_KEY)

    def call_gemini(prompt, image_bytes):
        resp = client.models.generate_content(
            model="gemini-flash-latest",
            contents=[prompt, types.Part.from_bytes(data=image_bytes, mime_type="image/png")],
        )
        return resp.text.strip()

    image = Image.open(args.image).convert("RGB")
    logger.info(f"OFFLINE: {args.image} ({image.width}x{image.height}px), "
                f"rect={'none' if args.no_crop else args.rect}")
    result = read_rates(image, "offline", call_gemini, args.rect, args.no_crop, args.bookaway_cost)
    return [result]


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


def run_live(args):
    from PIL import ImageGrab
    from pywinauto.keyboard import send_keys
    from agent.prime_driver import PrimeDriver
    from agent.error_codes import PrimeError

    leg = {
        "origin": args.origin,
        "destination": args.destination,
        "date": (datetime.now() + timedelta(days=3)).strftime("%a, %b %d %Y"),
        "time": args.time,
        "accommodation": args.accommodation,
    }
    logger.info(f"LIVE: {leg['origin']}->{leg['destination']} {leg['date']} "
                f"{leg['time']} {leg['accommodation']}")

    driver = PrimeDriver()
    driver.click_refresh()

    def rates_rect():
        pane = driver.main_window.child_window(title_re=" *Rates *", control_type="Pane")
        r = pane.rectangle()
        return (r.left, r.top, r.right, r.bottom)

    def grab_and_read(phase):
        rect = rates_rect()
        logger.info(f"[{phase}] Rates pane rect={rect}")
        return read_rates(ImageGrab.grab(), phase, driver._call_gemini, rect, False,
                          args.bookaway_cost)

    results = []
    try:
        driver.fill_trip_details(leg, "One Way")
        driver.fill_personal_details(TEST_PASSENGER, TEST_CONTACT)
    except PrimeError as e:
        logger.error(f"FAIL: form did not fill: [{e.error_code.value}] {e}")
        driver._dismiss_error_popup()
        driver.click_refresh()
        sys.exit(1)

    results.append(grab_and_read("1_before_issue"))

    logger.info("--- Clicking Issue (will answer No) ---")
    driver.click_issue()
    confirm, error_dlg = wait_for_confirm()
    if confirm is None:
        logger.error("No Confirm popup"
                     + (f"; PRIME showed '{error_dlg.window_text()}'" if error_dlg else
                        f" within {CONFIRM_WAIT_SEC}s") + ". Stopping.")
        driver._save_debug_screenshot("rates_gemini_no_confirm")
        driver._dismiss_error_popup()
        driver.click_refresh()
        sys.exit(1)
    time.sleep(1.0)  # let PRIME finish painting the pane
    results.append(grab_and_read("2_popup_open"))

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
            driver._save_debug_screenshot("rates_gemini_confirm_stuck")
            sys.exit(1)
    except Exception:  # noqa: BLE001
        pass
    results.append(grab_and_read("3_popup_closed"))

    driver.click_refresh()
    time.sleep(1.0)
    results.append(grab_and_read("4_after_refresh"))
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--image", help="offline: saved full-screen PNG to read")
    p.add_argument("--rect", default=",".join(map(str, DEFAULT_RECT)),
                   help="offline: Rates pane L,T,R,B in screen px (default: VM Nov 9 run)")
    p.add_argument("--no-crop", action="store_true", help="offline: send the full screenshot")
    p.add_argument("--live", action="store_true", help="drive PRIME: fill, Issue, read, No, read")
    p.add_argument("--bookaway-cost", type=float, default=None,
                   help="Bookaway per-passenger costInSupplierCurrency (PHP) to validate against")
    p.add_argument("origin", nargs="?", default="CEB")
    p.add_argument("destination", nargs="?", default="TAG")
    p.add_argument("time", nargs="?", default="6:00 AM")
    p.add_argument("accommodation", nargs="?", default="TC")
    args = p.parse_args()
    args.accommodation = args.accommodation.upper()
    args.rect = tuple(int(x) for x in args.rect.split(","))

    if not args.image and not args.live:
        p.error("pass --image <png> (offline) or --live")

    logger.info("=" * 60)
    results = run_offline(args) if args.image else run_live(args)

    logger.info("")
    logger.info("=" * 60)
    logger.info("SUMMARY — Gemini read of the Rates pane")
    for r in results:
        n = r["numbers"]
        logger.info(
            f"{r['phase']}: accom={r['parsed']['ACCOM'] or '-'} trip={r['parsed']['TRIP'] or '-'} "
            f"fare={n['FARE']} discount={n['DISCOUNT']} terminal_fee={n['TERMINAL_FEE']} "
            f"total_due={n['TOTAL_DUE']}"
        )
        logger.info(f"    {r['msg']}")
    logger.info("=" * 60)
    failed = [r for r in results if r["ok"] is False]
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

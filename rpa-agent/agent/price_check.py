"""Price check: compare PRIME's Rates pane against Bookaway's supplier cost.

Pure functions only (no pywinauto, no Gemini) so they are unit-testable with
pytest. The driver does the screenshot + Gemini call and feeds the raw text in.

Business rule (Nov 2026): Bookaway stores OceanJet's fare minus the 5%
agreement discount, which finance settles monthly and PRIME never shows.
The orchestrator sends `expectedTotalDuePerPax` = Bookaway cost / 0.95, and
PRIME's Total Due for the first passenger must match it to the centavo.

PRIME shows Total Due per ticket issue:
- one-way: one leg                      -> Total Due == expected
- round-trip: both legs in one issue    -> Total Due == expected (sum of legs)
- connecting: one issue per leg         -> each leg < expected, legs sum == expected
"""

import re

TOLERANCE_PHP = 0.01

RATES_FIELDS = ("ACCOM", "TRIP", "FARE", "DISCOUNT", "TERMINAL_FEE", "TOTAL_DUE")

RATES_PROMPT = (
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

_MONEY_RE = re.compile(r"-?\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|-?\s?\d+(?:\.\d{1,2})?")


def parse_money(text: str):
    """'1,450.00' -> 1450.0; '- 0.00' -> 0.0; '' / junk -> None."""
    if not text:
        return None
    m = _MONEY_RE.search(text)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", "").replace(" ", ""))
    except ValueError:
        return None


def parse_rates_response(raw: str) -> dict:
    """Parse Gemini's RATES_PROMPT answer.

    Returns {"accom": str, "trip": str, "fare": float|None, "discount": float|None,
             "terminal_fee": float|None, "total_due": float|None, "raw": str}.
    """
    fields = {f: "" for f in RATES_FIELDS}
    for line in (raw or "").splitlines():
        line = line.strip()
        for f in RATES_FIELDS:
            if line.upper().startswith(f + ":"):
                fields[f] = line[len(f) + 1:].strip()
    return {
        "accom": fields["ACCOM"],
        "trip": fields["TRIP"],
        "fare": parse_money(fields["FARE"]),
        "discount": parse_money(fields["DISCOUNT"]),
        "terminal_fee": parse_money(fields["TERMINAL_FEE"]),
        "total_due": parse_money(fields["TOTAL_DUE"]),
        "raw": raw or "",
    }


def amounts_match(actual: float, expected: float) -> bool:
    return abs(actual - expected) <= TOLERANCE_PHP


def evaluate_leg(total_due, expected_total: float, prior_legs_total: float,
                 is_last_leg: bool) -> tuple[str, str]:
    """Decide whether PRIME's Total Due for one issue is acceptable.

    Args:
        total_due: PRIME Total Due read for this issue (None if unreadable).
        expected_total: Bookaway-derived expected PRIME total for the whole
            passenger (all legs), i.e. cost / (1 - discount).
        prior_legs_total: Total Due already accepted on earlier legs of the
            same passenger (0 for one-way / round-trip).
        is_last_leg: True when this issue completes the passenger's legs.

    Returns (verdict, detail) where verdict is one of:
        "match"      -> safe to click Yes
        "mismatch"   -> click No, booking-level PRICE_MISMATCH
        "unreadable" -> Total Due could not be read
    """
    if total_due is None:
        return "unreadable", "Total Due not readable from the Rates pane"
    if total_due <= 0:
        return "mismatch", f"PRIME Total Due {total_due:,.2f} is not a positive fare"

    running = prior_legs_total + total_due
    if is_last_leg:
        if amounts_match(running, expected_total):
            return "match", (
                f"PRIME Total Due {running:,.2f} == expected {expected_total:,.2f}"
            )
        return "mismatch", (
            f"PRIME Total Due {running:,.2f} != expected {expected_total:,.2f} "
            f"(difference {running - expected_total:+,.2f} PHP)"
        )

    # Intermediate connecting leg: must leave room for the remaining leg(s)
    if running + TOLERANCE_PHP < expected_total:
        return "match", (
            f"PRIME Total Due {total_due:,.2f} so far {running:,.2f} < expected {expected_total:,.2f}"
        )
    return "mismatch", (
        f"PRIME Total Due {total_due:,.2f} (running {running:,.2f}) already reaches or exceeds "
        f"expected {expected_total:,.2f} with legs still to issue"
    )

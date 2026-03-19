# Plan: OceanJet PRIME RPA Agent — Phase 1 (Form Fill & Test)

## Context

The TypeScript orchestrator is complete (Phase 1 done, 45 tests passing). It polls Bookaway for pending bookings, translates them to OceanJet PRIME format, and sends them to the RPA agent via HTTP POST `/issue-tickets`.

We now need to build the **Python RPA agent** that receives this data and drives PRIME's desktop UI on a Windows VM. The VM is set up (Python 3.12.9, pywinauto, Pillow installed). PRIME's UI has been inspected via Accessibility Insights — it's a **Delphi VCL** app with controls targetable by parent pane name + child index.

**This phase focuses on form-filling only** — no Issue button click. We want to verify that data flows correctly from Bookaway → orchestrator → RPA agent → PRIME fields before committing to real ticket issuance. The code must be reusable across multiple VMs.

## Structure

All RPA agent code goes in `rpa-agent/` at the project root. This folder is what gets copied to each VM.

```
rpa-agent/
├── agent/
│   ├── __init__.py
│   ├── config.py          # Env-based config (port, tokens, timeouts, PRIME title)
│   ├── error_codes.py     # TicketErrorCode enum + PrimeError exception
│   ├── date_utils.py      # Bookaway→PRIME date conversion, departure time matching
│   ├── prime_driver.py    # pywinauto logic: connect to PRIME, fill forms, select voyages
│   └── server.py          # FastAPI HTTP server (POST /issue-tickets, GET /health)
├── tests/
│   └── test_date_utils.py # Unit tests for date/time parsing
├── test_fill_form.py      # Standalone test: hardcoded booking → fill PRIME form
├── requirements.txt
├── .env.example
├── install.bat
├── start.bat
└── README.md
```

## Implementation Steps

### Step 1: Scaffolding (`requirements.txt`, `.env.example`, `install.bat`, `start.bat`)

- **requirements.txt**: pywinauto, Pillow, anthropic, fastapi, uvicorn, python-dotenv
- **.env.example**: `RPA_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `RPA_PORT=8080`, `PRIME_TIMEOUT_SEC=30`
- **install.bat**: `py -m pip install -r requirements.txt` (uses `py` not `python` per VM setup)
- **start.bat**: `py -m uvicorn agent.server:app --host 0.0.0.0 --port 8080`

### Step 2: `agent/config.py`

Load from `.env` via `python-dotenv`:
- `PRIME_WINDOW_TITLE` (default: `"Prime Software - OCEAN FAST FERRIES CORPORATION Build 20231109E"`)
- `RPA_AUTH_TOKEN`, `RPA_PORT`, `ANTHROPIC_API_KEY`, `PRIME_TIMEOUT_SEC`

### Step 3: `agent/error_codes.py`

- Python `TicketErrorCode(str, Enum)` mirroring all 14 codes from `src/operators/types.ts`
- `PrimeError(Exception)` carrying `error_code` and `message`

### Step 4: `agent/date_utils.py`

Two functions:

**`bookaway_date_to_prime(date_str) -> str`**
- Input: `"Fri, Apr 18th 2025"` → Output: `"4/18/25"`
- Strip weekday prefix, strip ordinal suffix (st/nd/rd/th), parse, format as `M/D/YY`
- Note: we'll type this into the date field; the underscore prefix is PRIME's mask placeholder, not something we type

**`match_departure_time(target_time, grid_times) -> int | None`**
- Input: target `"1:00 PM"`, grid datetimes from Claude Vision like `["3/27/2026 7:30:00 AM", ...]`
- Match on hour + minute + AM/PM only, return 0-based row index

### Step 5: `agent/prime_driver.py` — Core file

**Class `PrimeDriver`** with these methods:

**`__init__()`** — Connect to PRIME via UIA backend. Store window reference.

**`ensure_issue_new_ticket_screen()`** — Check if ISSUE NEW TICKET pane exists; if not, navigate via sidebar tree (Transactions → Passage → Issue New Ticket).

**`click_refresh()`** — Click Refresh button to reset form between passengers.

**`fill_trip_details(leg, trip_type, return_leg=None)`** — Fill the Trip Details pane:
1. Select trip type radio button (`'One Way'` or `'Round Trip'`)
2. Fill departure date in `edit[1]` (PRIME date format)
3. Select origin in `combo_box[2]`
4. Select destination in `combo_box[1]`
5. Click voyage search `button[1]` → opens Voyage Schedule dialog
6. Call `select_voyage(leg.time)` (Claude Vision)
7. Select accommodation in `combo_box[0]`
8. If round-trip: fill return date in `edit[0]`, click `button[0]`, select return voyage

Control indices follow the reversed tree order documented in `docs/prime-ui-inspection.md`.

**`select_voyage(target_time) -> str`** — Claude Vision voyage selection:
1. Connect to Voyage Schedule dialog (win32 backend for TDBGrid)
2. `grid.capture_as_image()` → PIL Image
3. Send to Claude API: extract rows as JSON with departure datetimes
4. `match_departure_time()` to find target row
5. Arrow-key navigate to row, click Select button
6. Return voyage number for logging
7. Error cases: empty grid → `TRIP_NOT_FOUND`, no time match → `VOYAGE_TIME_MISMATCH`

**`fill_personal_details(passenger, contact_info="")`** — Fill Personal Details pane:
1. First Name in `edit[2]`
2. Last Name in `edit[3]`
3. Age in `edit[5]`
4. Sex in `combo_box[0]`: map `"Male"→"M"`, `"Female"→"F"`
5. Contact Info in `edit[0]` (booking email)
6. Leave M.I. and ID Number empty

**`fill_booking(booking)`** — High-level orchestration based on `bookingType`:
- **one-way**: For each passenger: refresh → fill_trip_details(departureLeg, "One Way") → fill_personal_details
- **round-trip**: For each passenger: refresh → fill_trip_details(departureLeg, "Round Trip", returnLeg) → fill_personal_details
- **connecting-one-way**: For each passenger, for each leg in connectingLegs: refresh → fill_trip_details(leg, "One Way") → fill_personal_details
- **connecting-round-trip**: Same but also processes connectingReturnLegs
- In Phase 1: **stops before Issue button** — just fills the form

### Step 6: `test_fill_form.py` — Standalone test script

Run directly on the VM: `py test_fill_form.py`

- Hardcoded one-way booking (CEB→TAG, single passenger, Tourist class)
- Creates PrimeDriver, calls fill_booking()
- Prints step-by-step progress
- CLI flags: `--round-trip`, `--connecting` for other booking types
- Does NOT click Issue — user visually verifies fields via AnyDesk

### Step 7: `agent/server.py` — FastAPI server

- Pydantic models mirroring `TranslatedBooking` and `TicketResult` from `src/operators/types.ts`
- `POST /issue-tickets`: Bearer token auth → validate body → call PrimeDriver.fill_booking() → return TicketResult
- `GET /health`: check PRIME is running, return `{"status": "ok", "prime_running": true/false}`
- Single-worker (one booking at a time — PRIME has one UI)
- In Phase 1: returns `success: true` with empty ticket arrays (dry run mode)

### Step 8: `tests/test_date_utils.py` — Unit tests

- Test date conversion: various formats, edge cases (Jan 1st, single-digit months)
- Test time matching: exact match, no match, AM/PM edge cases (noon, midnight)
- Can run anywhere (no PRIME needed)

### Step 9: `README.md`

Setup instructions for new VMs: install Python, copy folder, run install.bat, configure .env, ensure PRIME is open, run start.bat.

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| pywinauto backend | UIA for main form, win32 for Voyage Schedule | UIA gives pane names for navigation; win32 gives Delphi class names (TDBGrid) |
| Grid reading | Screenshot → Claude Vision API | TDBGrid doesn't expose cell data via Win32 or UIA; OCR couldn't be installed (TLS issues); Claude Vision is most reliable |
| Control targeting | Parent pane name + child type index | Leaf controls have no Name property; indices within named panes are stable |
| Date field input | Type keys (not set_edit_text) | Delphi masked edit fields may reject programmatic text setting |
| Gender mapping | "Male"→"M", "Female"→"F" | PRIME Sex dropdown only has M and F options |
| Serialization | Single uvicorn worker + no concurrency | PRIME has one UI; can only process one booking at a time |

## Verification

1. **Unit tests**: `py -m pytest tests/` on any machine — validates date parsing and time matching
2. **Form fill test**: On the VM with PRIME open, run `py test_fill_form.py` — visually verify all fields are correctly populated via AnyDesk
3. **Server test**: Start server with `start.bat`, then `curl -X POST http://VM_IP:8080/issue-tickets -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{...}'` — verify response and PRIME form state
4. **Orchestrator integration**: Set `OPERATOR_MODE=rpa` and `RPA_AGENT_URL=http://VM_IP:8080` in orchestrator's `.env`, run against staging — verify form fills from a real Bookaway booking

## Files to Create

| File | Action |
|---|---|
| `rpa-agent/requirements.txt` | Create |
| `rpa-agent/.env.example` | Create |
| `rpa-agent/install.bat` | Create |
| `rpa-agent/start.bat` | Create |
| `rpa-agent/agent/__init__.py` | Create (empty) |
| `rpa-agent/agent/config.py` | Create |
| `rpa-agent/agent/error_codes.py` | Create |
| `rpa-agent/agent/date_utils.py` | Create |
| `rpa-agent/agent/prime_driver.py` | Create |
| `rpa-agent/agent/server.py` | Create |
| `rpa-agent/test_fill_form.py` | Create |
| `rpa-agent/tests/__init__.py` | Create (empty) |
| `rpa-agent/tests/test_date_utils.py` | Create |
| `rpa-agent/README.md` | Create |

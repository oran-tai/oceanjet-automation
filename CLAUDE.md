# OceanJet Automated Booking Integration

## Project Overview
Monorepo with two microservices that automate OceanJet ferry bookings from Bookaway. Both run on the same Windows VM.

## Architecture
- **Orchestrator** (`orchestrator/`): TypeScript/Node.js — polls Bookaway API, translates bookings, sends to RPA, approves
- **RPA Agent** (`rpa-agent/`): Python — drives OceanJet PRIME desktop app via pywinauto
- Communication: HTTP POST to `localhost:8080` between orchestrator and RPA agent

## Key Commands

### Orchestrator (from `orchestrator/`)
- `npm run dev` — run with tsx (development)
- `npm run build` — compile TypeScript
- `npm start` — run compiled JS
- `npm test` — run tests with vitest

### RPA Agent (from `rpa-agent/`)
- `py -m uvicorn agent.server:app --host 0.0.0.0 --port 8080` — start server
- `py test_fill_form.py` — test form fill
- `py -m pytest tests/ -v` — run unit tests

## Project Structure
```
orchestrator/           # TypeScript microservice
  src/bookaway/         — Bookaway API client and types
  src/operators/        — Operator modules (OceanJet mapper, RPA client, mock)
  src/orchestrator/     — Polling loop and booking processor
  src/events/           — BigQuery event publisher (best-effort lifecycle tracking)
  src/notifications/    — Slack webhook alerts
  src/utils/            — Logger, time utilities
  tests/                — Unit tests (vitest)

rpa-agent/              # Python microservice
  agent/                — PRIME driver, FastAPI server, error codes
  tests/                — Error scenario tests (standalone scripts)

docs/                   # Shared documentation
setup.ps1               # VM setup script (installs everything)
```

## VM Operations

### Updating VM with latest code
```batch
update-oceanjet
```
If not installed, create it: `(echo @echo off& echo cd /d C:\oceanjet-automation& echo git pull origin main& echo cd /d C:\oceanjet-automation\rpa-agent& echo py -m pip install -r requirements.txt --quiet& echo cd /d C:\oceanjet-automation\orchestrator& echo call npm install --silent& echo echo Updated!& echo pause) > C:\Windows\update-oceanjet.bat`

### Setting TARGET_BOOKING on VM
```batch
cd C:\oceanjet-automation\orchestrator && powershell -Command "(Get-Content .env) -replace 'TARGET_BOOKING=.*', 'TARGET_BOOKING=BW1234567' | Set-Content .env"
```

### Starting services on VM
1. Open PRIME and log in to Issue New Ticket screen
2. Start RPA Agent: `run-rpa` (runs `cd C:\oceanjet-automation\rpa-agent && start.bat`)
3. Start Orchestrator: `run-orch` (runs `cd C:\oceanjet-automation\orchestrator && start.bat`)

### Stopping the automation gracefully
```batch
stop
```
Creates a `.stop` file that the orchestrator picks up between bookings — finishes the current booking, then exits cleanly with no error notifications. The RPA agent stays idle until you close its window manually.

### Checking env file
```batch
type C:\oceanjet-automation\orchestrator\.env
```

## Conventions
- All credentials in `.env` only — never commit secrets
- Each microservice has its own `.env` and `.env.example`
- Bearer tokens are never logged
- OceanJet supplier ID: `5c6147b2967ae90001ca6702`
- Station codes, accommodation codes, connecting routes are in `orchestrator/src/operators/oceanjet/config.ts`
- Booking types: one-way, round-trip, connecting route (detected automatically by mapper)
- RPA integration tests must be standalone scripts (not pytest) due to COM threading conflicts
- PRIME dialog text is not accessible via UIA — use Gemini Vision screenshot OCR
- Gemini Vision calls: centralized in `_call_gemini()` with 3 retries, exponential backoff, and a 60s per-call timeout (prevents stuck calls from leaving stale screenshots)

## RPA Error Handling — Key Patterns

**Three Gemini OCR call sites in the post-Confirm / blocker-detection code:**
1. `_read_post_confirm_popup()` — used by `_handle_confirm_dialog` after Yes-on-Confirm. Structured prompt (`POPUP: SUCCESS|ERROR|NONE` + `TEXT` / `CODES` / `FIRST_NAME` / `LAST_NAME`). Explicit "respond NONE if no popup is visible — do NOT describe form contents" to prevent the form rates panel from being misread as popup text. Saves the screenshot to `debug/post_confirm_no_popup_*.png` whenever it returns no popup so we can diagnose retroactively.
2. `_ocr_post_confirm_screen()` — used inside `_check_error_after_confirm` when the UIA scan times out. Looks for popup + seat availability (TC/OA/BC). 10-retry × 30s sleeps (~5min budget).
3. `_classify_form_blocker()` — used on station-select failure and inside `_dismiss_error_popup`. Four-way classification: `success_popup` / `print_preview` / `error_popup` / `none`. When `success_popup`, also reads `First Name` / `Last Name` from the form behind the popup so orphan tickets carry the pax identity.

**`_handle_confirm_dialog` retry budget:** 5 OCR attempts × 30s sleeps (~2.5min) when no popup is visible — UIA finds the popup window before PRIME finishes painting its pixels (observed: 30s+ window-create-to-text-paint gap under load). Never clicks OK on the popup when classification fails — leaves it for the safe cleanup block.

**`_dismiss_error_popup()` is popup-aware** — refuses to dismiss success popups:
- Finds candidate small `OCEAN FAST FERRIES` window (top-level or child of main window)
- Calls `_classify_form_blocker()` before pressing Enter / clicking OK
- If `success_popup` → returns `{codes, first_name, last_name, text}` instead of dismissing
- Otherwise dismisses as before
- Caller responsibility: convert the returned dict into `ORPHAN_TICKET_DETECTED` so codes are preserved for manual reconciliation

**`_dismiss_same_station_dialog()`** is a separate helper for the 'Origin and Destination must not be the same' case — a fast inline dismiss on combo change, not an error-flow cleanup. Do not merge it into `_dismiss_error_popup()`.

**Sold-out detection** has two trigger points:
1. COMError on gender combo → popup blocking form → `_check_sold_out_after_voyage()`
2. After Issue → Confirm → Yes, ticket popup never appears → `_check_error_after_confirm()`
Both screenshot the main window, send to Gemini for popup text + seat availability (TC/OA/BC), and leave the popup open for the caller's cleanup block to dismiss.

**Orphan ticket detection** (`ORPHAN_TICKET_DETECTED`, system-level error):
1. Most reliable: cleanup-block `_dismiss_error_popup()` discovers a late-arriving success popup → upgrades the passenger's error to `ORPHAN_TICKET_DETECTED` with codes + pax name from the form, then safely dismisses (codes already preserved) so the next booking starts clean
2. Cross-booking: next booking's first station-select fails → `_select_station_with_recovery` calls classifier → success popup detected → raise `ORPHAN_TICKET_DETECTED` with codes + pax name
Slack alert includes the ticket codes and pax First/Last Name (read by Gemini from the form behind the popup) so the operator can reconcile manually in Bookaway.

**Error cleanup**: all errors run `_dismiss_error_popup()` (now popup-aware) + `click_refresh()` before breaking. If `_dismiss_error_popup` returns a dict (orphan detected), cleanup upgrades the error to `ORPHAN_TICKET_DETECTED` and then dismisses safely.

**Station dropdown retry**: if `select()` fails, `_select_station_with_recovery` classifies the blocker via Gemini and dispatches: success_popup → raise `ORPHAN_TICKET_DETECTED`, print_preview → close, error_popup → dismiss + retry, none → retry anyway then raise `STATION_NOT_FOUND`.

## Pacing
- Inter-booking delay: 30–90s (orchestrator, only after approved bookings)
- Inter-passenger delay: 5–15s (RPA agent)
- Booking error cooldown: 24h default (`BOOKING_ERROR_COOLDOWN_MS`), in-memory, resets on restart

## Infrastructure
- **Slack webhooks**: 2 webhooks (`SLACK_WEBHOOK_URL`, `SLACK_WEBHOOK_URL_2`). Booking-level alerts go to both, system-level alerts go to webhook 1 only. Exceptions: `STATION_NOT_FOUND` booking failures go to webhook 1 only (listed in `PRIMARY_ONLY_BOOKING_ERRORS` in `slack.ts`). Each retries 3x with 1s/2s backoff
- **BigQuery events**: 5 types (`booking_claimed`, `booking_skipped`, `booking_failed`, `booking_approved`, `poll_cycle_completed`) to `travelier-ai:oceanjet.booking_events`. All failures use `booking_failed` with `error_code`. Best-effort — never blocks main flow. Config: `BQ_PROJECT_ID`, `BQ_KEY_FILE`

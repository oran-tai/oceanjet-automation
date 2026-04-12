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
- Gemini Vision calls: centralized in `_call_gemini()` with retries and exponential backoff

## RPA Error Handling — Key Patterns

**Do not merge these two functions** — they handle different popup types via different UIA approaches:
- `_dismiss_error_popup()`: desktop-level search + `set_focus()` + Enter (top-level popups)
- `_dismiss_same_station_dialog()`: child window search on `main_window` (inline dialog)

**Sold-out detection** has two trigger points:
1. COMError on gender combo → popup blocking form → `_check_sold_out_after_voyage()`
2. After Issue → Confirm → Yes, ticket popup never appears → `_check_error_after_confirm()`
Both screenshot the main window, send to Gemini for popup text + seat availability (TC/OA/BC), and leave the popup open for the caller's cleanup block to dismiss.

**Error cleanup**: all errors (booking + system level) run `_dismiss_error_popup()` + `click_refresh()` before breaking, preventing cascading failures into the next booking.

**Station dropdown retry**: if `select()` fails, dismiss any blocking error popup and retry once before raising `STATION_NOT_FOUND`.

## Pacing
- Inter-booking delay: 30–90s (orchestrator, only after approved bookings)
- Inter-passenger delay: 5–15s (RPA agent)
- Booking error cooldown: 24h default (`BOOKING_ERROR_COOLDOWN_MS`), in-memory, resets on restart

## Infrastructure
- **Slack webhooks**: 2 webhooks (`SLACK_WEBHOOK_URL`, `SLACK_WEBHOOK_URL_2`). Booking-level alerts go to both, system-level alerts go to webhook 1 only. Each retries 3x with 1s/2s backoff
- **BigQuery events**: 5 types (`booking_claimed`, `booking_skipped`, `booking_failed`, `booking_approved`, `poll_cycle_completed`) to `travelier-ai:oceanjet.booking_events`. All failures use `booking_failed` with `error_code`. Best-effort — never blocks main flow. Config: `BQ_PROJECT_ID`, `BQ_KEY_FILE`

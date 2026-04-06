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

### Checking env file
```batch
type C:\oceanjet-automation\orchestrator\.env
```

## Important Conventions
- All credentials in `.env` only — never commit secrets
- Each microservice has its own `.env` and `.env.example`
- Bearer tokens are never logged
- OceanJet supplier ID: `5c6147b2967ae90001ca6702`
- Station codes, accommodation codes, connecting routes are in `orchestrator/src/operators/oceanjet/config.ts`
- Booking types: one-way, round-trip, connecting route (detected automatically by mapper)
- RPA integration tests must be standalone scripts (not pytest) due to COM threading conflicts
- Pacing: inter-booking delay (90–180s, orchestrator, only after approved bookings) + inter-passenger delay (5–15s, RPA agent) + TRIP_NOT_FOUND cooldown (24h default, `TRIP_NOT_FOUND_COOLDOWN_MS`)
- PRIME error popups are top-level desktop windows (not children of main window) — `_dismiss_error_popup()` uses desktop-level search + `set_focus()` + Enter. `_dismiss_same_station_dialog()` uses child window search (different UIA approach, do not merge them)
- TRIP_SOLD_OUT: detected when popup blocks form interaction (COMError on gender combo), Gemini Vision reads popup text + seat availability
- BigQuery events: 5 types (`booking_claimed`, `booking_skipped`, `booking_failed`, `booking_approved`, `poll_cycle_completed`) to `travelier-ai:oceanjet.booking_events`. All failures use `booking_failed` with `error_code` to distinguish cause. Best-effort — never blocks main flow. Config: `BQ_PROJECT_ID`, `BQ_KEY_FILE`

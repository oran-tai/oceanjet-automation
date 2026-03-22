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
  src/notifications/    — Slack webhook alerts
  src/utils/            — Logger, time utilities
  tests/                — Unit tests (vitest)

rpa-agent/              # Python microservice
  agent/                — PRIME driver, FastAPI server, error codes
  tests/                — Error scenario tests (standalone scripts)

docs/                   # Shared documentation
setup.ps1               # VM setup script (installs everything)
```

## Important Conventions
- All credentials in `.env` only — never commit secrets
- Each microservice has its own `.env` and `.env.example`
- Bearer tokens are never logged
- OceanJet supplier ID: `5c6147b2967ae90001ca6702`
- Station codes, accommodation codes, connecting routes are in `orchestrator/src/operators/oceanjet/config.ts`
- Booking types: one-way, round-trip, connecting route (detected automatically by mapper)
- RPA integration tests must be standalone scripts (not pytest) due to COM threading conflicts

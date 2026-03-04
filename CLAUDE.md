# OceanJet Automated Booking Integration

## Project Overview
TypeScript orchestrator that automates OceanJet ferry bookings from Bookaway. Polls the Bookaway API for pending bookings, translates data to OceanJet PRIME format, issues tickets via an RPA agent on a Windows VM, and approves bookings back on Bookaway.

## Architecture
- **Orchestrator** (this project): TypeScript/Node.js — handles Bookaway API, data mapping, booking processing loop
- **RPA Agent** (separate, deferred): Python on Windows VM — drives OceanJet PRIME desktop app
- Communication: HTTP API between orchestrator and RPA agent

## Key Commands
- `npm run dev` — run with tsx (development)
- `npm run build` — compile TypeScript
- `npm start` — run compiled JS
- `npm test` — run tests with vitest

## Project Structure
- `src/bookaway/` — Bookaway API client and types
- `src/operators/` — Operator module interface, OceanJet config/mapper/RPA client, mock operator
- `src/orchestrator/` — Polling loop and booking processor
- `src/notifications/` — Slack webhook alerts
- `src/utils/` — Logger, time utilities
- `docs/` — PRD, API docs, reference sheets

## Important Conventions
- All credentials in `.env` only — never commit secrets
- Bearer tokens are never logged
- OceanJet supplier ID: `5c6147b2967ae90001ca6702`
- Station codes, accommodation codes, connecting routes are in `src/operators/oceanjet/config.ts`
- Booking types: one-way, round-trip, connecting route (detected automatically by mapper)

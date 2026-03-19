# OceanJet Automation — Implementation Status

**Last updated:** March 19, 2026

---

## What's Done

### Phase 1 TypeScript Orchestrator — Complete

The full orchestrator is implemented, compiles cleanly, and has been verified against the live Bookaway API. 47 unit tests passing. 10/10 real bookings successfully mapped end-to-end.

#### Core Components

| Component | File(s) | Status |
| --- | --- | --- |
| **Configuration** | `src/config.ts`, `.env.example` | Done |
| **Bookaway API Client** | `src/bookaway/client.ts`, `src/bookaway/types.ts` | Done — login, fetch bookings, fetch details, claim/release, approve. Auto token refresh on 401. |
| **OceanJet Data Mapper** | `src/operators/oceanjet/mapper.ts`, `src/operators/oceanjet/config.ts` | Done — station codes (7 confirmed from live API + 12 from reference sheet), accommodation codes, connecting route detection (6 routes), passenger extraction from extraInfos. |
| **Booking Processor** | `src/orchestrator/processor.ts` | Done — handles all 4 booking types, status re-check after fetch (skips non-pending), passenger validation (pre-PRIME), departure window validation, conditional TRIP_NOT_FOUND alerting (≤7 days only), approval with 3x retry, structured error code routing (12 error codes: 8 booking-level → release + continue, 4 system-level → release + stop). |
| **Orchestrator Loop** | `src/orchestrator/loop.ts`, `src/index.ts` | Done — continuous polling, claim-before-process, in-memory duplicate detection, graceful shutdown on SIGINT/SIGTERM. |
| **Slack Notifications** | `src/notifications/slack.ts` | Done — booking failure, system failure, partial failure, session expired alerts. |
| **Mock Operator** | `src/operators/mock/operator.ts` | Done — returns sequential fake ticket numbers for end-to-end testing without PRIME. |
| **RPA Client** | `src/operators/oceanjet/rpa-client.ts` | Done — HTTP client stub ready for the Python RPA agent. |
| **Logging** | `src/utils/logger.ts` | Done — structured JSON logging with Bearer token redaction. |
| **Time Utility** | `src/utils/time.ts` | Done — 24h → 12h conversion (e.g., "15:20" → "3:20 PM"). |

#### Tests

| Test File | Tests | What it covers |
| --- | --- | --- |
| `tests/time.test.ts` | 9 | Time conversion: noon, midnight, AM, PM, edge cases |
| `tests/config.test.ts` | 21 | Station codes (including real API city names), accommodation codes, connecting routes |
| `tests/mapper.test.ts` | 9 | All booking types, multi-passenger, real API city names, error cases |
| `tests/processor.test.ts` | 8 | Success flow, booking-level failure (TRIP_SOLD_OUT), system-level RPA error (PRIME_CRASH), UNKNOWN_ERROR fallback, thrown system error, departure window skip, non-pending status skip, passenger validation error |
| **Total** | **47** | All passing |

#### Documentation

| Document | Description |
| --- | --- |
| `docs/bookaway-backoffice-API-documentation-v2.md` | **Corrected** API documentation based on live API responses |
| `docs/bookaway-backoffice-API-documentation.md` | Original API docs (kept for reference — has incorrect field paths) |
| `docs/PRD-OceanJet-Automated-Booking-Integration.md` | Product Requirements Document |
| `docs/oceanjet-inventory-reference-sheet.md` | Station codes, accommodation codes, connecting routes |
| `docs/OceanJet-Bookaway-current-manual-booking-flow.md` | Current manual workflow description |
| `CLAUDE.md` | Project conventions and structure for AI-assisted development |

#### Live API Validation Results

Tested against 10 real pending bookings from the Bookaway queue — all mapped successfully:

| Route | Type | Pax | Class |
| --- | --- | --- | --- |
| Cebu → Siquijor | connecting-one-way (via TAG) | 1 | OA |
| Tagbilaran City, Bohol Island → Siquijor | one-way | 4 | TC |
| Tagbilaran City, Bohol Island → Siquijor | one-way | 2 | TC |
| Tagbilaran City, Bohol Island → Siquijor | one-way | 7 | TC |
| Tagbilaran City, Bohol Island → Siquijor | one-way | 2 | BC |
| Cebu → Bohol | one-way | 2 | OA |
| Cebu → Bohol | one-way | 2 | TC |
| Cebu → Bohol | one-way | 2 | TC |
| Cebu → Bohol | one-way | 3 | TC |
| Maasin City, Leyte → Cebu | one-way | 2 | TC |

All 3 accommodation types (TC, BC, OA), connecting route detection, and real API city names ("Tagbilaran City, Bohol Island", "Maasin City, Leyte") all working correctly.

---

## Key Discoveries from Live API

Several fields in the original API documentation were incorrect. The corrected paths are documented in `docs/bookaway-backoffice-API-documentation-v2.md`. Summary:

| Topic | Original Doc | Actual API |
| --- | --- | --- |
| Origin/Destination City | `items[0].product.tripInfo.fromId.city.name` | `items[0].trip.fromId.city.name` |
| Item ID | `items[0]._id` | Items have no `_id`; use `items[0].reference` (e.g., `"IT5645919"`) |
| Passenger Age | `items[0].passengers[i].age` (direct field) | `extraInfos` with definition ID `58f47da902e97f000888b000` |
| Passenger Gender | `extraInfos` with `definition: "Gender"` | `extraInfos` with definition ID `58f47db102e97f000888b001` |
| Accommodation Class | `items[0].product.vehicle.class` = `"Tourist Class"` | `items[0].product.lineClass` = `"Tourist"` |
| City Name: Bohol | `"Bohol / Tagbilaran"` | `"Bohol"` or `"Tagbilaran City, Bohol Island"` |
| City Name: Maasin | `"Maasin"` | `"Maasin City, Leyte"` |
| Return fields (one-way) | Not present / undefined | Present but empty string `""` |

---

## Next Steps

### 1. ~~Validate the Approval API~~ — Done (March 18, 2026)

Validated via E2E staging test. Key finding: `approvalInputs` does **not** include an `_id` field — including it causes a 500 "Cast to ObjectId" error. The correct payload only contains `bookingCode`, `departureTrip`, and `returnTrip`. Code and docs updated accordingly.

### 2. ~~Build the Python RPA Agent~~ — Phase 1 Done (March 19, 2026)

The RPA agent is implemented in `rpa-agent/` and deployed on the Windows VM. Phase 1 = form fill only (no Issue button click).

**What's working:**
- Connects to PRIME via pywinauto UIA backend
- Fills Trip Details: trip type, date, origin, destination, voyage selection, accommodation
- Fills Personal Details: first name, last name, age, gender, contact info
- Voyage selection via PIL ImageGrab screenshot → Gemini Flash vision API
- Handles all 4 booking types (one-way, round-trip, connecting-one-way, connecting-round-trip)
- Error detection: `STATION_NOT_FOUND`, `TRIP_NOT_FOUND`, `VOYAGE_TIME_MISMATCH`, `ACCOMMODATION_UNAVAILABLE`, `PRIME_TIMEOUT`, `PRIME_CRASH`, `RPA_INTERNAL_ERROR`
- Passenger validation in orchestrator (pre-PRIME): `PASSENGER_VALIDATION_ERROR`
- Slack notifications from RPA agent (configurable via `SLACK_WEBHOOK_URL`)
- One-click VM deployment via `setup.ps1` + `update-rpa` command
- FastAPI HTTP server with bearer token auth

**Error Code Status (12 total):**

| Error Code | Type | Implemented? | Tested? | Slack Alert? | How it's triggered | Orchestrator behavior |
|---|---|---|---|---|---|---|
| `STATION_NOT_FOUND` | Booking | Yes | **VM passed** | Always | Origin/destination not in PRIME dropdown | Skip booking, continue loop |
| `TRIP_NOT_FOUND` | Booking | Yes | **VM passed** | Only if departure ≤ 7 days | Voyage Schedule grid is empty | Skip booking, continue loop |
| `VOYAGE_TIME_MISMATCH` | Booking | Yes | **VM passed** | Always | No voyage matches departure time | Skip booking, continue loop |
| `ACCOMMODATION_UNAVAILABLE` | Booking | Yes | **VM passed** | Always | Accommodation code not in dropdown | Skip booking, continue loop |
| `PASSENGER_VALIDATION_ERROR` | Booking | Yes | **Unit test** | Always | Missing/invalid name, age, or gender | Skip booking, continue loop (pre-PRIME) |
| `TRIP_SOLD_OUT` | Booking | No | — | Always | Voyage exists but no seats available | Skip booking, continue loop |
| `PRIME_VALIDATION_ERROR` | Booking | No | — | Always | PRIME rejects form on Issue click (Phase 2) | Skip booking, continue loop |
| `PRIME_TIMEOUT` | System | Yes | — | Always | Dialog doesn't appear in time | **Stop loop**, alert operator |
| `PRIME_CRASH` | System | Yes | — | Always | Can't connect to PRIME process | **Stop loop**, alert operator |
| `SESSION_EXPIRED` | System | No | — | Always | PRIME login session timed out | **Stop loop**, alert operator |
| `RPA_INTERNAL_ERROR` | System | Yes | — | Always | Screenshot/API/internal failure | **Stop loop**, alert operator |
| `UNKNOWN_ERROR` | Catch-all | No | — | Always | Unexpected unhandled exception | **Stop loop**, alert operator |

**Score:** 8/12 implemented, 5/12 tested (4 VM + 1 unit test).

**Not yet implemented:** Issue button click, ticket number capture, `TRIP_SOLD_OUT`, `PRIME_VALIDATION_ERROR`, `SESSION_EXPIRED` (all Phase 2).

### 3. End-to-End Test with Mock Operator

Run `npm run dev` against the real Bookaway API in mock mode to verify the full loop:

```
Poll → Claim → Translate → Mock Tickets → Approve
```

**Warning:** This will actually approve real bookings with fake ticket numbers. Should only be done on test bookings or with the approval step disabled.

### 4. Clean Up Exploration Scripts

The `tests/api-*.ts` scripts were used during development to explore the live API. They can be:

- Moved to a `scripts/` directory for future use
- Removed if no longer needed

### 5. Deferred Items (from original plan)

- **Dashboard/logs UI** — P1 nice-to-have
- **Multi-bot parallelism** — P1 nice-to-have
- **Automated cancellations** — P2
- **Real-time inventory syncing** — P2
- **Multi-operator expansion** — P2

---

## How to Run

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run in development mode (mock operator)
npm run dev

# Build and run compiled
npm run build
npm start
```

Configuration is in `.env` (copy from `.env.example`). Set `OPERATOR_MODE=mock` for testing, `OPERATOR_MODE=rpa` for production with the RPA agent.

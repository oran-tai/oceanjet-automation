# OceanJet Automation — Implementation Status

**Last updated:** March 4, 2026

---

## What's Done

### Phase 1 TypeScript Orchestrator — Complete

The full orchestrator is implemented, compiles cleanly, and has been verified against the live Bookaway API. 43 unit tests passing. 10/10 real bookings successfully mapped end-to-end.

#### Core Components

| Component | File(s) | Status |
| --- | --- | --- |
| **Configuration** | `src/config.ts`, `.env.example` | Done |
| **Bookaway API Client** | `src/bookaway/client.ts`, `src/bookaway/types.ts` | Done — login, fetch bookings, fetch details, claim/release, approve. Auto token refresh on 401. |
| **OceanJet Data Mapper** | `src/operators/oceanjet/mapper.ts`, `src/operators/oceanjet/config.ts` | Done — station codes (7 confirmed from live API + 12 from reference sheet), accommodation codes, connecting route detection (6 routes), passenger extraction from extraInfos. |
| **Booking Processor** | `src/orchestrator/processor.ts` | Done — handles all 4 booking types, departure window validation, approval with 3x retry, error handling (booking-level vs system-level vs partial failure). |
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
| `tests/processor.test.ts` | 4 | Success flow, booking failure, system failure, departure window skip |
| **Total** | **43** | All passing |

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

### 1. Validate the Approval API (High Priority)

The `approvalInputs._id` field currently uses `items[0].reference` (e.g., `"IT5645919"`). This needs to be tested with one real approval call to confirm it's the correct identifier. Options:

- Test on a booking that's already been manually approved (if the API allows re-approval)
- Test on a real pending booking with real ticket numbers from PRIME
- Ask a Bookaway team member to confirm the expected value

### 2. Build the Python RPA Agent (Blocked — needs Windows VM)

The orchestrator is ready to call the RPA agent via HTTP POST to `/issue-tickets`. The RPA agent needs to:

- Run on a Windows VM with OceanJet PRIME installed
- Accept translated booking data via HTTP
- Drive PRIME to issue tickets (navigate, enter data, capture ticket numbers)
- Return ticket numbers (or errors) back to the orchestrator

Technology: Python with pywinauto or similar RPA library.

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

# OceanJet Automation — Implementation Status

**Last updated:** April 5, 2026

---

## What's Done

### Phase 1 TypeScript Orchestrator — Complete

The full orchestrator is implemented, compiles cleanly, and has been verified against the live Bookaway API. 47 unit tests passing. 10/10 real bookings successfully mapped end-to-end.

#### Core Components

| Component | File(s) | Status |
| --- | --- | --- |
| **Configuration** | `orchestrator/src/config.ts`, `.env.example` | Done — TARGET_BOOKING support, env var trimming for Windows compatibility, BigQuery config |
| **Bookaway API Client** | `orchestrator/src/bookaway/client.ts`, `types.ts` | Done — login, fetch bookings (limit 500), fetch details, claim/release, approve. Auto token refresh on 401. |
| **OceanJet Data Mapper** | `orchestrator/src/operators/oceanjet/mapper.ts`, `config.ts` | Done — station codes (8 confirmed from live API + 12 from reference sheet), accommodation codes, connecting route detection (6 routes), passenger extraction from extraInfos, contactInfo from first passenger. |
| **Booking Processor** | `orchestrator/src/orchestrator/processor.ts` | Done — handles all 4 booking types, status re-check after fetch (skips non-pending), passenger validation (pre-PRIME), departure window validation, conditional TRIP_NOT_FOUND alerting (≤7 days only), approval with 3x retry, structured error code routing (12 error codes: 8 booking-level → release + continue, 4 system-level → release + stop). |
| **Orchestrator Loop** | `orchestrator/src/orchestrator/loop.ts`, `src/index.ts` | Done — continuous polling, claim-before-process, TARGET_BOOKING filter, in-memory duplicate detection, TRIP_NOT_FOUND 24h cooldown, graceful shutdown on SIGINT/SIGTERM. |
| **Slack Notifications** | `orchestrator/src/notifications/slack.ts` | Done — booking failure, system failure, partial failure, session expired alerts. |
| **Mock Operator** | `orchestrator/src/operators/mock/operator.ts` | Done — returns sequential fake ticket numbers for end-to-end testing without PRIME. |
| **RPA Client** | `orchestrator/src/operators/oceanjet/rpa-client.ts` | Done — HTTP client for the Python RPA agent. |
| **BigQuery Events** | `orchestrator/src/events/bigquery.ts`, `types.ts` | Done — 5 event types (`booking_claimed`, `booking_skipped`, `booking_failed`, `booking_approved`, `poll_cycle_completed`) to `travelier-ai:oceanjet.booking_events`. Best-effort, never blocks main flow. Service account auth. |
| **Logging** | `orchestrator/src/utils/logger.ts` | Done — structured JSON logging with Bearer token redaction. |
| **Time Utility** | `orchestrator/src/utils/time.ts` | Done — 24h → 12h conversion (e.g., "15:20" → "3:20 PM"). |

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
| `docs/bookaway-backoffice-API-documentation-v2.md` | Bookaway API documentation (corrected based on live API responses) |
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

### 2. ~~Build the Python RPA Agent~~ — Phase 2 Done (March 22, 2026)

The RPA agent is implemented in `rpa-agent/` and deployed on the Windows VM. Full end-to-end automation is working: form fill → Issue ticket → capture ticket number → close print preview.

**First successful fully automated booking:** BW4946194 (TAG→SIQ, 2 passengers, Tourist class) — tickets 13003466, 13003467 issued and approved on Bookaway. ~90 seconds for 2 passengers.

**What's working:**
- Connects to PRIME via pywinauto UIA backend
- Fills Trip Details: trip type, date, origin, destination, voyage selection, accommodation
- Fills Personal Details: first name, last name, age, gender, contact info (email from first passenger)
- Voyage selection via PIL ImageGrab screenshot → Gemini Flash vision API
- Issue button click → Confirm dialog (Yes) → success dialog capture → ticket number extraction
- Dialog text reading via Gemini Vision screenshot (Delphi paints text directly, not accessible via UIA)
- Print preview auto-close after each ticket issuance (loops only for expected count: 1 for one-way, 2 for round-trip)
- Handles all 4 booking types (one-way, round-trip, connecting-one-way, connecting-round-trip)
- Error detection: all 12 error codes implemented
- Critical safety: failed ticket capture after Confirm → RPA_INTERNAL_ERROR (system-level stop)
- All errors (booking + system) stop processing remaining passengers
- TARGET_BOOKING mode: process a single booking by reference, then stop
- Slack notifications for all failure types
- Both services run on same VM (localhost:8080)
- One-click VM deployment via `setup.ps1` + `update-oceanjet` command
- FastAPI HTTP server with bearer token auth
- **Multi-passenger optimizations** (March 31, 2026):
  - Voyage-only mode: pax 2+ on same leg skip redundant trip field filling (trip type, dates, stations, accommodation already retained after Refresh)
  - Gemini Vision cache: parsed grid rows cached by `origin|destination|date` — pax 2+ reuse cached rows, skipping screenshot + API call
  - Both scoped per `fill_booking()` call — each booking starts fresh, no cross-booking leakage
  - **Inter-passenger pacing** (April 5, 2026): Random 5–15s delay between ticket issuances within the same booking (`PASSENGER_DELAY_MIN_S` / `PASSENGER_DELAY_MAX_S`)
  - **Sold-out popup detection** (April 5, 2026): When PRIME shows a "No seats available" popup after voyage selection, it blocks form interaction (COMError). RPA catches this, screenshots the main window, uses Gemini Vision to read both popup text and Trip Availability seat counts (TC/OA/BC), dismisses the popup, and raises `TRIP_SOLD_OUT` with availability details for Slack alerts
  - **Error popup dismissal**: Separate `_dismiss_error_popup()` (desktop-level search + `set_focus()` + Enter key) from `_dismiss_same_station_dialog()` (child window search) — different popup types require different UIA approaches

**Error Code Status (12 total):**

| Error Code | Type | Implemented? | Tested? | Slack Alert? | How it's triggered | Orchestrator behavior |
|---|---|---|---|---|---|---|
| `STATION_NOT_FOUND` | Booking | Yes | **VM passed** | Always | Origin/destination not in PRIME dropdown | Release booking, stop loop |
| `TRIP_NOT_FOUND` | Booking | Yes | **VM passed** | Only if departure ≤ 7 days | Voyage Schedule grid is empty | Release booking, stop loop |
| `VOYAGE_TIME_MISMATCH` | Booking | Yes | **VM passed** | Always | No voyage matches departure time | Release booking, stop loop |
| `ACCOMMODATION_UNAVAILABLE` | Booking | Yes | **VM passed** | Always | Accommodation code not in dropdown | Release booking, stop loop |
| `PASSENGER_VALIDATION_ERROR` | Booking | Yes | **Unit test** | Always | Missing/invalid name, age, or gender | Release booking, continue loop (pre-PRIME) |
| `TRIP_SOLD_OUT` | Booking | Yes | **VM passed** | Always | Voyage exists but no seats available — detected via COMError when popup blocks form, Gemini Vision reads popup text + Trip Availability seat counts (TC/OA/BC) | Release booking, continue loop |
| `PRIME_VALIDATION_ERROR` | Booking | Yes | — | Always | PRIME rejects form on Issue click | Release booking, stop loop |
| `PRIME_TIMEOUT` | System | Yes | — | Always | Dialog doesn't appear in time | **Stop loop**, alert operator |
| `PRIME_CRASH` | System | Yes | — | Always | Can't connect to PRIME process | **Stop loop**, alert operator |
| `SESSION_EXPIRED` | System | No | — | Always | PRIME login session timed out | **Stop loop**, alert operator |
| `RPA_INTERNAL_ERROR` | System | Yes | — | Always | Screenshot/API/internal failure, failed ticket capture | **Stop loop**, alert operator |
| `UNKNOWN_ERROR` | Catch-all | Yes | — | Always | Unexpected unhandled exception | **Stop loop**, alert operator |

**Score:** 11/12 implemented, 6/12 tested (5 VM + 1 unit test).

**Not yet implemented:** `SESSION_EXPIRED` (requires PRIME session timeout detection).

### 3. ~~First Production E2E Test~~ — Done (March 22, 2026)

Full end-to-end production test completed:

```
Poll Bookaway → Claim → Translate → RPA fill PRIME form → Issue tickets → Capture ticket numbers → Approve on Bookaway
```

Booking BW4946194: TAG→SIQ, one-way, 2 passengers (Mathieu Cloutier, Marika Veilleux), Tourist class. Tickets 13003466 and 13003467 issued and approved successfully.

### 4. Architecture — Monorepo with Two Microservices

Both services run on the same Windows VM:

```
C:\oceanjet-automation\
├── orchestrator\    Node.js — polls Bookaway, translates, approves
├── rpa-agent\       Python — drives PRIME UI
└── setup.ps1        One-click VM setup
```

Communication: orchestrator → HTTP POST localhost:8080/issue-tickets → RPA agent.

### 5. Remaining Work

- **`SESSION_EXPIRED`** — detect PRIME login session timeout
- **~~Round-trip ticket count~~** — resolved: PRIME returns 2 tickets per passenger (departure + return), comma-separated in one dialog. Code updated to split them correctly.
- **~~Events table → BigQuery~~** — Done (April 5, 2026). 5 event types to `travelier-ai:oceanjet.booking_events`, service account auth, best-effort publishing.
- **~~Multi-booking continuous mode~~** — Done (April 5, 2026). First-cycle validation guard removed, inter-booking pacing delays added (90–180s after approved bookings, no delay on skipped/errored), inter-passenger delays (5–15s). Target throughput: ~15 bookings/hour.
- **Automated cancellations** — P2
- **Real-time inventory syncing** — P2
- **Multi-operator expansion** — P2

---

## How to Run

### On the VM (production)

1. Open PRIME and log in to Issue New Ticket screen
2. Start RPA Agent: `cd C:\oceanjet-automation\rpa-agent && start.bat`
3. Start Orchestrator: `cd C:\oceanjet-automation\orchestrator && start.bat`

To process a single booking, set `TARGET_BOOKING=BW1234567` in `orchestrator/.env`.

### Development (local)

```bash
cd orchestrator
npm install
npm test          # Run 47 unit tests
npm run dev       # Run with mock operator
```

### Updating the VM

```batch
update-oceanjet
```

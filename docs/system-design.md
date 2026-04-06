# OceanJet Automation — System Design

**Last updated:** April 5, 2026

---

## Overview

Two microservices running on the same Windows VM automate OceanJet ferry bookings from Bookaway:

- **Orchestrator** (TypeScript/Node.js) — polls Bookaway for pending bookings, translates them to PRIME format, sends to the RPA agent, and approves on Bookaway after tickets are issued.
- **RPA Agent** (Python/FastAPI) — receives translated booking data via HTTP, drives PRIME's desktop UI via pywinauto to issue tickets, and returns ticket numbers or structured error codes.

## Architecture

```
Windows VM (both services on same machine)
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌─────────────────────────┐     ┌──────────────────────────┐  │
│  │  Orchestrator           │     │  RPA Agent               │  │
│  │  (Node.js/TypeScript)   │     │  (Python/FastAPI)        │  │
│  │                         │     │                          │  │
│  │  - Polls Bookaway API   │ HTTP│  POST /issue-tickets     │  │
│  │  - Claims bookings      │────►│  GET  /health            │  │
│  │  - Translates data      │     │                          │  │
│  │  - Approves bookings    │◄────│  Drives PRIME via        │  │
│  │  - Slack alerts         │ JSON│  pywinauto + Gemini      │  │
│  │  - Error routing        │     │  Vision for OCR          │  │
│  └─────────────────────────┘     └────────────┬─────────────┘  │
│                                                │                │
│                                                ▼                │
│                                   ┌──────────────────────────┐  │
│                                   │  OceanJet PRIME          │  │
│                                   │  (Delphi desktop app)    │  │
│                                   └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
oceanjet-automation/
├── orchestrator/                # TypeScript microservice
│   ├── src/
│   │   ├── bookaway/            — API client and types
│   │   │   ├── client.ts        — Login, fetch bookings, claim, release, approve
│   │   │   └── types.ts         — BookingDetail, Passenger, ApprovalRequest, etc.
│   │   ├── operators/
│   │   │   ├── oceanjet/
│   │   │   │   ├── mapper.ts    — Bookaway → PRIME data translation
│   │   │   │   ├── config.ts    — Station codes, accommodation codes, connecting routes
│   │   │   │   └── rpa-client.ts — HTTP client for the RPA agent
│   │   │   ├── mock/
│   │   │   │   └── operator.ts  — Returns fake ticket numbers for testing
│   │   │   └── types.ts         — TranslatedBooking, TicketResult, error codes
│   │   ├── events/
│   │   │   ├── bigquery.ts      — Best-effort event publisher to BigQuery
│   │   │   └── types.ts         — EventType union and BookingEvent interface
│   │   ├── orchestrator/
│   │   │   ├── loop.ts          — Continuous polling, claim-before-process, graceful shutdown
│   │   │   └── processor.ts     — Booking processing, error routing, approval with retry
│   │   ├── notifications/
│   │   │   └── slack.ts         — Booking/system failure alerts
│   │   ├── utils/
│   │   │   ├── logger.ts        — Structured JSON logging, Bearer token redaction
│   │   │   └── time.ts          — 24h→12h time conversion
│   │   ├── config.ts            — Env-based config, TARGET_BOOKING, BigQuery, Windows trim compat
│   │   └── index.ts             — Entry point
│   └── tests/                   — 47 unit tests (vitest)
│
├── rpa-agent/                   # Python microservice
│   ├── agent/
│   │   ├── server.py            — FastAPI HTTP server (POST /issue-tickets, GET /health)
│   │   ├── prime_driver.py      — pywinauto logic: connect, fill forms, issue tickets
│   │   ├── error_codes.py       — TicketErrorCode enum + PrimeError exception
│   │   ├── date_utils.py        — Date conversion, departure time matching
│   │   └── config.py            — Port, auth token, timeouts, Gemini API key
│   ├── tests/
│   │   ├── test_date_utils.py               — Unit tests (pytest-safe)
│   │   ├── test_error_station_not_found.py  — Standalone PRIME integration test
│   │   └── test_error_trip_not_found.py     — Standalone PRIME integration test
│   ├── test_fill_form.py        — Standalone happy-path test
│   ├── requirements.txt
│   ├── install.bat / start.bat
│   └── .env.example
│
├── docs/                        # Shared documentation
├── setup.ps1                    # One-click VM setup script
└── CLAUDE.md
```

## API Contract

### POST /issue-tickets

**Request body:** `TranslatedBooking` (same shape as `src/operators/types.ts`)

```json
{
  "bookingId": "abc123",
  "reference": "BW1234567",
  "bookingType": "one-way",
  "passengers": [
    { "firstName": "John", "lastName": "Doe", "age": "30", "gender": "Male" }
  ],
  "departureLeg": {
    "origin": "CEB",
    "destination": "TAG",
    "date": "Fri, Apr 18th 2025",
    "time": "1:00 PM",
    "accommodation": "TC"
  }
}
```

**Success response (200):**

```json
{
  "success": true,
  "departureTickets": ["1234567"],
  "returnTickets": [],
  "errorCode": null,
  "error": null,
  "partialResults": null
}
```

**Booking-level failure (200):**

```json
{
  "success": false,
  "departureTickets": [],
  "returnTickets": [],
  "errorCode": "TRIP_SOLD_OUT",
  "error": "No seats available for voyage CEB→TAG at 1:00 PM",
  "partialResults": null
}
```

**Partial failure (200):**

```json
{
  "success": false,
  "departureTickets": ["1234567"],
  "returnTickets": [],
  "errorCode": "PASSENGER_VALIDATION_ERROR",
  "error": "PRIME rejected passenger 2",
  "partialResults": [
    { "passengerIndex": 0, "passengerName": "John Doe", "tickets": ["1234567"], "success": true },
    { "passengerIndex": 1, "passengerName": "Jane Doe", "tickets": [], "success": false, "errorCode": "PASSENGER_VALIDATION_ERROR", "error": "Invalid age" }
  ]
}
```

**System-level failure (500):**

```json
{
  "success": false,
  "departureTickets": [],
  "returnTickets": [],
  "errorCode": "PRIME_CRASH",
  "error": "PRIME process not found",
  "partialResults": null
}
```

### GET /health

Returns `200 OK` with:

```json
{
  "status": "ok",
  "prime_running": true
}
```

The orchestrator can use this to check the agent is up before sending bookings.

## Error Code Mapping

The agent must map what it observes in PRIME's UI to one of these error codes:

| What the agent sees in PRIME | Error code |
|---|---|
| Station code not in origin/destination dropdown | `STATION_NOT_FOUND` |
| No voyages listed after selecting stations + date | `TRIP_NOT_FOUND` |
| Voyage exists but "Sold Out" or no seats (detected via popup after voyage selection, with seat availability from Trip Availability section via Gemini Vision) | `TRIP_SOLD_OUT` |
| No voyage matches the expected departure time | `VOYAGE_TIME_MISMATCH` |
| Class exists but no seats in that class | `ACCOMMODATION_UNAVAILABLE` |
| PRIME rejects passenger details (name/age/gender) | `PASSENGER_VALIDATION_ERROR` |
| "Already booked" or duplicate warning | `DUPLICATE_PASSENGER` |
| Date blocked or unavailable | `DATE_BLACKOUT` |
| Any other unexpected PRIME dialog/error | `PRIME_VALIDATION_ERROR` |
| PRIME stops responding (timeout) | `PRIME_TIMEOUT` |
| PRIME process disappears | `PRIME_CRASH` |
| Login screen appears during operation | `SESSION_EXPIRED` |
| Agent internal exception | `RPA_INTERNAL_ERROR` |
| Can't classify the failure | `UNKNOWN_ERROR` |

## PRIME UI Flow (per passenger)

1. Click **Refresh** to reset form
2. Select trip type: **One Way** or **Round Trip**
3. Enter departure **date** (format: `M/D/YY`)
4. Select **origin** station code from dropdown
5. Select **destination** station code from dropdown
6. Click voyage search button → opens **Voyage Schedule** dialog
7. Screenshot the voyage grid → send to **Gemini Flash Vision** → extract rows as JSON → match departure time → arrow-key navigate → click **Select**
8. Select **accommodation** type from dropdown (TC, BC, OA)
9. If round-trip: enter return date, search return voyages, select return voyage
10. Enter **first name**, **last name**, **age**, **sex** (M/F), **contact info** (email)
11. Click **Issue** → **Confirm Yes**
12. Wait 3s for result dialog → screenshot → **Gemini Flash Vision** → extract ticket number from "Process Complete. Ticket number(s): [XXXXXXXX]."
13. Click **OK** to dismiss success dialog
14. Wait 3s → close **Print Preview** window(s) — only loops for expected count (1 for one-way, 2 for round-trip)
15. If more passengers remain: **random 5–15s pacing delay** before next passenger

Repeat for each passenger. For connecting routes, repeat for each leg. For round-trip connecting, repeat for all 4 legs.

**Critical safety**: If step 12 fails to capture a ticket number after Confirm Yes (ticket is already issued), the RPA raises `RPA_INTERNAL_ERROR` (system-level stop) to prevent duplicate tickets.

### Multi-Passenger Optimizations

For passengers 2+ on the **same leg** (non-connecting bookings), the RPA skips redundant work:

- **Voyage-only mode**: After Refresh, trip fields (type, dates, origin, destination, accommodation) are retained from the previous passenger. Steps 2-5 and 8 are skipped — only voyage search + selection is performed (steps 6-7).
- **Gemini Vision cache**: Parsed voyage grid rows are cached by `origin|destination|date`. For passengers on the same route+date, the screenshot + Gemini API call is skipped and cached rows are reused. Keyboard navigation to select the row still runs.

These optimizations apply differently by booking type:

| Booking type | Voyage-only mode | Gemini cache |
|---|---|---|
| One-way, N pax | Pax 2+ skip trip fields | Pax 2+ use cached grid |
| Round-trip, N pax | Pax 2+ skip trip fields | Pax 2+ use cached grid (dep + ret) |
| Connecting, N pax | Never (legs alternate) | Pax 2+ use cached grid per leg |

Cache and voyage-only state are scoped to a single `fill_booking()` call — each booking starts fresh.

## Deployment

### First-time setup on a new VM

1. Clone the repo to `C:\oceanjet-automation`
2. Run `setup.ps1` (installs Git, Node.js, Python, dependencies)
3. Create `.env` files for both orchestrator and RPA agent
4. Open PRIME and log in to Issue New Ticket screen
5. Start RPA Agent: `cd C:\oceanjet-automation\rpa-agent && start.bat`
6. Start Orchestrator: `cd C:\oceanjet-automation\orchestrator && start.bat`

### Updating

```batch
update-oceanjet
```

This alias (created by `setup.ps1`) does `git pull` and `npm install`.

### Stopping

```batch
stop
```

Creates a `.stop` file that the orchestrator detects between bookings. Finishes the current booking, exits cleanly with no error notifications. The RPA agent stays idle — close its window manually.

### Multi-VM scaling

Each VM runs its own PRIME instance + both services. Each bot uses its own PRIME license.

## Security

- The RPA agent requires a Bearer token (`RPA_AUTH_TOKEN`) on all requests
- Both services share this token via their respective `.env` files
- Both services run on localhost — no external network exposure needed for inter-service communication
- Bearer tokens are redacted from all log output
- All credentials stored in `.env` only — never committed to git

## PRIME Application Details

Discovered via Accessibility Insights inspection on March 18-19, 2026. Full details in `docs/prime-ui-inspection.md`.

| Field | Value |
|---|---|
| Window title | `Prime Software - OCEAN FAST FERRIES CORPORATION Build 20231109E` |
| UI framework | **Delphi VCL** (class names: `TDBGrid`, `TButton`, `TPanel`, `TEdit`, etc.) |
| pywinauto backend | `uia` for all interactions (win32 fails with 64-bit Python on 32-bit PRIME) |
| Grid reading | PIL ImageGrab screenshot → Gemini Flash (vision) — TDBGrid doesn't expose cell data |
| Control identification | Parent pane name + child index (leaf controls have no `Name` property) |

## Dependencies

### Orchestrator (Node.js)

```
axios              # HTTP client for Bookaway API and RPA agent
@google-cloud/bigquery  # BigQuery event publishing
dotenv             # Environment variable loading
winston            # Structured JSON logging
```

### RPA Agent (Python)

```
pywinauto          # UI automation (UIA backend)
Pillow             # Screenshot capture (PIL ImageGrab)
google-genai       # Gemini Flash API for grid + dialog OCR
fastapi            # HTTP server
uvicorn            # ASGI server
python-dotenv      # Environment variable loading
```

## Orchestrator Processing Flow

For each poll cycle, the orchestrator:

1. Fetches up to 500 pending bookings from Bookaway (sorted by departure date)
2. Filters out already-claimed bookings, in-memory duplicates, booking error cooldown bookings, and TARGET_BOOKING mismatches
3. For each unclaimed booking:
   a. Claims it on Bookaway (`inProgressBy` = bot identifier)
   b. Fetches full booking details
   c. **Re-checks status is still `pending`** — skips if status changed (e.g., manually approved)
   d. Validates passengers (name, age, gender) pre-PRIME — fails with `PASSENGER_VALIDATION_ERROR` if invalid
   e. Validates departure is within PRIME's 2-month booking window
   f. Translates to OceanJet PRIME format (mapper resolves station codes, accommodation, connecting routes, 24h→12h time)
   g. Sends to RPA agent via POST `localhost:8080/issue-tickets`
   h. On success: approves on Bookaway (with 3x retry), then **random 90–180s pacing delay**
   i. On booking-level error: releases booking, sends Slack alert, adds to 24h cooldown cache, continues immediately (no delay)
   j. On system-level error: releases booking, sends Slack alert, **stops the loop**
4. If `TARGET_BOOKING` is set, stops after processing that booking
5. Otherwise waits `pollingIntervalMs`, then repeats

### Pacing Configuration

Human-like throughput pacing to avoid detection:

| Layer | Config | Default | When applied |
|---|---|---|---|
| Inter-booking (orchestrator) | `BOOKING_DELAY_MIN_MS` / `BOOKING_DELAY_MAX_MS` | 90000 / 180000 (1.5–3 min) | After each **approved** booking only |
| Inter-passenger (RPA agent) | `PASSENGER_DELAY_MIN_S` / `PASSENGER_DELAY_MAX_S` | 5 / 15 (5–15s) | Between ticket issuances within same booking |
| Booking error cooldown (orchestrator) | `BOOKING_ERROR_COOLDOWN_MS` | 86400000 (24h) | After any booking-level error — silently skipped until cooldown expires. First occurrence sends alert + BQ event normally. In-memory, resets on restart. |

Combined with ~1.5 min average processing time, this yields ~15 bookings/hour (~4 min per booking).

### Orchestrator Data Translation

The mapper (`orchestrator/src/operators/oceanjet/mapper.ts`) handles:

- **Booking type detection**: one-way, round-trip (via `misc.returnDepartureDate`), connecting (via route lookup), connecting-round-trip
- **Station codes**: Bookaway city names → PRIME codes (some cities have multiple API names, e.g., "Bohol" and "Tagbilaran City, Bohol Island" both → TAG, "Calapan" and "Calapan, Mindoro Island" → CAL)
- **Accommodation**: `product.lineClass` ("Tourist" → TC, "Business" → BC, "Open Air" → OA)
- **Connecting routes**: 6 routes through TAG and MAA hubs, with hardcoded departure times per leg
- **Passengers**: name from direct fields, age/gender from `extraInfos` by definition ID
- **Contact info**: `items[0].passengers[0].contact.email` (first passenger's email)
- **Time**: 24h → 12h conversion (e.g., "15:20" → "3:20 PM")

### Bookaway Approval Payload

```json
{
  "extras": [],
  "pickups": [{ "time": 0, "location": null }],
  "dropOffs": [null],
  "voucherAttachments": [],
  "approvalInputs": {
    "bookingCode": "13003466 13003467",
    "departureTrip": {
      "seatsNumber": ["13003466", "13003467"],
      "ticketsQrCode": []
    },
    "returnTrip": {
      "seatsNumber": [],
      "ticketsQrCode": []
    }
  }
}
```

Note: `approvalInputs` must **not** include an `_id` field — including it causes a 500 "Cast to ObjectId" error.

## BigQuery Events

The orchestrator publishes lifecycle events to `travelier-ai:oceanjet.booking_events` for observability and analytics. Events are best-effort — publish failures are logged but never block the main flow.

### Event Types

| Event | When emitted | Key fields |
|---|---|---|
| `booking_claimed` | Booking claimed on Bookaway | `booking_id`, `reference` |
| `booking_skipped` | Not pending or outside 2-month window | `skip_reason` |
| `booking_failed` | Any failure (validation, RPA, approval) | `error_code`, `error_detail` |
| `booking_approved` | Full success end-to-end | `tickets_issued_count`, `departure_tickets`, `return_tickets`, `duration_ms` |
| `poll_cycle_completed` | Poll cycle finished | `approved_count`, `skipped_count`, `booking_errors_count`, `system_errors_count` |

All events include `event_id` (UUID), `timestamp` (UTC), and `environment` (stage/prod).

### Failure Differentiation

All failures emit `booking_failed` — the `error_code` field distinguishes the cause:

| Category | Error codes |
|---|---|
| Booking-level (release + continue) | `PASSENGER_VALIDATION_ERROR`, `STATION_NOT_FOUND`, `TRIP_NOT_FOUND`, `TRIP_SOLD_OUT`, `VOYAGE_TIME_MISMATCH`, `ACCOMMODATION_UNAVAILABLE`, `PRIME_VALIDATION_ERROR`, `UNKNOWN_ERROR` |
| System-level (release + stop) | `PRIME_TIMEOUT`, `PRIME_CRASH`, `SESSION_EXPIRED`, `RPA_INTERNAL_ERROR` |
| Approval (keep claimed) | `APPROVAL_FAILED` |

### Dashboard Metrics

Key metrics derived from the events table:

| Metric | Formula | Notes |
|---|---|---|
| **Bookings per hour** | Approved count ÷ (total processing time + pacing delays) in hours | Processing time from `duration_ms` on approved events. Pacing = (N-1) × 135s average delay between approved bookings. |
| **Hours saved** | (processing time for all outcomes + pacing delays) in hours | Sums `duration_ms` from approved + failed + skipped events, plus pacing delays between approved bookings. Counts only active work time — gaps between sessions are excluded. |
| **Automation success rate** | Approved ÷ (Approved + Failed excluding inventory errors) | Excludes TRIP_NOT_FOUND, TRIP_SOLD_OUT, VOYAGE_TIME_MISMATCH, ACCOMMODATION_UNAVAILABLE — these are not automation failures. |

### Auth

Service account `oceanjet-events@travelier-ai.iam.gserviceaccount.com` with `bigquery.dataEditor` role. Config via `BQ_PROJECT_ID` and `BQ_KEY_FILE` env vars. If `BQ_PROJECT_ID` is empty, events are silently disabled.

## Resolved Questions

- **What happens after clicking Issue?** → Confirmation dialog appears ("Are you sure?"). Click Yes to issue. ~3s later, a result dialog appears.
- **What does the success dialog look like?** → "Process Complete. Ticket number(s): [XXXXXXXX]." — text is painted directly on the Delphi window surface, **not accessible via UIA**. Must use Gemini Vision screenshot OCR to read it.
- **What does a failure/error dialog look like?** → Same Delphi dialog with error message text. Also requires Gemini Vision to read. Error text is mapped to error codes by the RPA agent.
- **Does PRIME have any idle timeout or auto-logout?** → Still unknown. `SESSION_EXPIRED` error code is defined but detection is not yet implemented (1 of 12 error codes remaining).
- **Does PRIME return 1 or 2 ticket numbers for a round-trip booking?** → **2 ticket numbers per passenger**, comma-separated in one dialog: `[13023072,13023073]`. First = departure, second = return. For 2 passengers round-trip: booking code = all 4 tickets, `departureTrip.seatsNumber` = [dep1, dep2], `returnTrip.seatsNumber` = [ret1, ret2].

## Open Questions

- [ ] How to detect PRIME session expiration (`SESSION_EXPIRED`)?

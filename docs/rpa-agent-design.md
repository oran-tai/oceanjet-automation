# RPA Agent — Design Document

**Last updated:** March 19, 2026

---

## Overview

The RPA agent is a lightweight Python HTTP service that runs on a Windows VM alongside OceanJet PRIME. It receives translated booking data from the TypeScript orchestrator, drives PRIME's UI to issue tickets, and returns ticket numbers or structured error codes.

## Architecture

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│  Orchestrator (Mac/Server)  │         │  Windows VM                      │
│                             │  HTTP   │                                  │
│  TypeScript                 │────────>│  Python RPA Agent (FastAPI)      │
│  - Polls Bookaway           │  POST   │  - Receives booking data         │
│  - Claims bookings          │ /issue  │  - Drives PRIME via pywinauto    │
│  - Sends translated data    │-tickets │  - Clicks buttons, fills forms   │
│  - Approves on Bookaway     │<────────│  - Captures ticket numbers       │
│                             │  JSON   │  - Returns tickets or error code │
│                             │ response│                                  │
│                             │         │  OceanJet PRIME (desktop app)    │
└─────────────────────────────┘         └──────────────────────────────────┘
```

## Project Structure

```
rpa-agent/
├── agent/
│   ├── __init__.py
│   ├── server.py          # FastAPI HTTP server (POST /issue-tickets, GET /health)
│   ├── prime_driver.py    # pywinauto logic — drives PRIME UI to issue tickets
│   ├── error_codes.py     # TicketErrorCode enum + PrimeError exception
│   ├── date_utils.py      # Bookaway→PRIME date conversion, departure time matching
│   └── config.py          # Port, auth token, timeouts, PRIME window title, Gemini API key
├── tests/
│   ├── test_date_utils.py           # Unit tests (pytest-safe, no pywinauto)
│   ├── test_error_station_not_found.py  # Standalone PRIME integration test
│   └── test_error_trip_not_found.py     # Standalone PRIME integration test
├── test_fill_form.py      # Standalone happy-path test (one-way, round-trip, connecting)
├── requirements.txt       # pywinauto, google-genai, fastapi, uvicorn, Pillow
├── setup.ps1              # One-click PowerShell installer for VMs
├── install.bat            # Installs Python dependencies
├── start.bat              # Starts the HTTP server
├── .env.example
└── README.md              # Setup instructions for new VMs
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
| Voyage exists but "Sold Out" or no seats | `TRIP_SOLD_OUT` |
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

Based on the manual workflow documented in `docs/OceanJet-Bookaway-current-manual-booking-flow.md`:

1. Navigate to **Transactions → Passage → Issue New Ticket**
2. Select trip type: **One Way** or **Round Trip**
3. Enter departure **date**
4. Select **origin** station code (e.g., CEB)
5. Select **destination** station code (e.g., TAG)
6. Click to load voyages
7. Select the voyage matching the departure **time**
8. Select **accommodation** type (TC, BC, OA)
9. Enter passenger: **first name**, **last name**, **age**, **gender**
10. Click **Issue** → Confirm **Yes**
11. Read **ticket number** from success dialog
12. Click **OK** to dismiss

Repeat steps 1-12 for each passenger. For multi-leg bookings (connecting routes, round-trips), repeat for each leg.

## Deployment

### First-time setup on a new VM

1. Install Python 3.11+ from python.org (check "Add to PATH")
2. Copy the `oceanjet-rpa-agent/` folder to the VM
3. Run `install.bat`
4. Ensure PRIME is open and logged in
5. Run `start.bat`
6. Update `RPA_AGENT_URL` in the orchestrator's `.env` to point to this VM's IP and port

### Multi-VM scaling

Each VM runs its own PRIME instance + RPA agent. The orchestrator can be configured to round-robin across multiple `RPA_AGENT_URL` endpoints. Each bot uses its own PRIME license.

## Security

- The agent requires a Bearer token (`RPA_AUTH_TOKEN`) on all requests
- The orchestrator and agent share this token via their respective `.env` files
- The agent only listens on a configurable port (default: 8080)
- The VM's security group should only allow inbound traffic from the orchestrator's IP

## PRIME Application Details

Discovered via Accessibility Insights inspection on March 18-19, 2026. Full details in `docs/prime-ui-inspection.md`.

| Field | Value |
|---|---|
| Window title | `Prime Software - OCEAN FAST FERRIES CORPORATION Build 20231109E` |
| UI framework | **Delphi VCL** (class names: `TDBGrid`, `TButton`, `TPanel`, `TEdit`, etc.) |
| pywinauto backend | `uia` for all interactions (win32 fails with 64-bit Python on 32-bit PRIME) |
| Grid reading | PIL ImageGrab screenshot → Gemini Flash (vision) — TDBGrid doesn't expose cell data |
| Control identification | Parent pane name + child index (leaf controls have no `Name` property) |

## Dependencies (Python, on the VM)

```
pywinauto          # UI automation
Pillow             # Screenshot capture (PIL ImageGrab)
google-genai       # Gemini Flash API for voyage grid reading
fastapi            # HTTP server
uvicorn            # ASGI server
python-dotenv      # Environment variable loading
```

## Orchestrator Processing Flow

For each poll cycle, the orchestrator:

1. Fetches up to 50 pending bookings from Bookaway (sorted by departure date)
2. Filters out already-claimed and already-processed bookings
3. For each unclaimed booking:
   a. Claims it on Bookaway
   b. Fetches full booking details
   c. **Verifies booking is still `pending`** — skips if status changed (e.g., manually approved)
   d. Validates departure is within PRIME's 1-month booking window
   e. Translates to OceanJet PRIME format
   f. Sends to RPA agent via POST `/issue-tickets`
   g. On success: approves on Bookaway (with 3x retry)
   h. On booking-level error: releases booking, sends Slack alert, continues to next
   i. On system-level error: releases booking, sends Slack alert, **stops the loop**
4. Waits `pollingIntervalMs`, then repeats

## Open Questions

- [ ] What happens after clicking **Issue**? (confirmation dialog details)
- [ ] What does the **success dialog** look like? (ticket number location)
- [ ] What does a **failure/error dialog** look like?
- [ ] Does PRIME have any idle timeout or auto-logout?

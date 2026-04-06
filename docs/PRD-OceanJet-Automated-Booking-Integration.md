# PRD: OceanJet Automated Booking Integration

**Author:** Oran S.
**Date:** March 3, 2026
**Status:** Phase 2 Complete (RPA Agent + First Production E2E)
**Stakeholders:** Operations, Engineering, OceanJet Partner Team

---

## 1. Problem Statement

Bookaway operations agents currently process approximately 3,666 OceanJet bookings per month (~44,000 annually) through a fully manual workflow that spans two disconnected systems: the Bookaway Admin web portal and OceanJet's PRIME desktop application. Because PRIME only accepts one passenger per ticket issuance flow, and each booking averages 2.3 passengers, agents are performing the manual copy-paste-and-click routine over 101,000 times per year.

This process takes ~10 minutes per booking, requires mental data translation (station name to 3-letter code, 24-hour to 12-hour time conversion, class name to accommodation code), and forces agents to temporarily store ticket numbers in external files due to a PRIME UX limitation. The result is a ~5% error rate (wrong names, times, or AM/PM mismatches), frequent processing backlogs during peak periods that force Bookaway to cancel valid bookings, and significant agent burnout on repetitive work.

The cost of inaction is measurable: lost bookings during peak volume, negative OceanJet reviews caused by Bookaway's internal bottleneck, and ~7,333 hours/year of agent time spent on a process that can be automated.

---

## 2. Goals

### User Goals
- **Faster confirmation for end customers:** Reduce the time between payment and receiving a confirmed OceanJet ticket, eliminating the anxiety of sitting in a "Pending" queue.
- **Zero manual data entry for agents:** Operations agents should not need to manually type passenger details, map station codes, or convert time formats.
- **Reliable booking fulfillment:** Every paid booking that can be fulfilled on OceanJet should be fulfilled — no more cancellations due to processing delays.

### Business Goals
- **Contribute to company OKR:** Directly support the objective "Increase operational efficiency with AI & Automation" by contributing to the KR of "8,000 hours/year freed in automated workflows."
- **Reduce processing time per booking:** From ~10 minutes to ~2 minutes (80% reduction).
- **Eliminate fulfillment errors:** Drive the error rate from ~5% to 0%.
- **Minimize manual agent intervention:** Target <5% of OceanJet bookings requiring human touchpoints.

---

## 3. Non-Goals

- **Real-time inventory syncing with OceanJet.** Reading live seat availability from PRIME to prevent overbooking on Bookaway is a valuable future capability, but adds significant complexity and is a separate initiative.
- **Automated cancellations and modifications.** Pushing cancellation or change requests from Bookaway back to OceanJet is out of scope for v1. Agents will continue to handle these manually.
- **Promotional or discounted ticket types.** The automation will handle standard Tourist Class, Business Class, and Open-Air accommodations only. Special promotional fares or discount codes are excluded.
- **Multi-operator expansion.** This PRD is scoped exclusively to OceanJet. Extending the automation framework to other ferry or transport operators is a future initiative.
- **PRIME API development.** We are not building or requesting an API from OceanJet. The solution will work with PRIME as-is via desktop automation.

---

## 4. User Stories

### End Customer
- **As a Bookaway customer,** I want to receive my confirmed OceanJet ticket quickly after booking so that I have peace of mind about my travel plans and can plan my trip logistics.

### Operations Agent
- **As an operations agent,** I want the system to automatically process pending OceanJet bookings end-to-end so that I can focus on complex edge cases and customer support instead of repetitive data entry.
- **As an operations agent,** I want to see which bookings the automation has processed, failed, or skipped so that I know exactly where my manual attention is needed.
- **As an operations agent,** I want the automation to gracefully handle failures (e.g., sold-out ferries, PRIME timeouts) and flag them clearly so that I can resolve them quickly without guessing what went wrong.

### Operations Manager
- **As an operations manager,** I want visibility into automation throughput, error rates, and processing times so that I can measure the impact and identify bottlenecks.
- **As an operations manager,** I want to be able to pause or disable the automation without disrupting the manual fallback workflow so that we maintain control during incidents.

### OceanJet (Partner)
- **As the OceanJet operator,** I want Bookaway to process all incoming booking requests efficiently so that we don't lose valid reservations to manual processing delays or receive negative reviews from unfulfilled bookings.

---

## 5. Requirements

### Must-Have (P0)

These represent the minimum viable automation. Without these, the feature cannot ship.

#### 5.1 Bookaway Queue Polling & Continuous Processing Loop
The system must authenticate with the Bookaway Backoffice API, fetch pending OceanJet bookings sorted by earliest departure date, and process them in a continuous loop. After each booking cycle completes — whether successfully approved, skipped, or failed with a notification — the system immediately moves on to the next eligible booking in the queue. The loop continues until there are no more pending bookings to process, at which point it polls again after a configurable interval.

**Acceptance Criteria:**
- Given the automation service is running, when pending OceanJet bookings exist in the queue, then the system fetches them using the Bookaway API with `status=pending`, `supplier=5c6147b2967ae90001ca6702`, and `sort=departureDate:1`.
- Given a booking is fetched, when no other agent or bot is working on it (`inProgressBy` is `null`), then the system claims it by setting `inProgressBy` to the bot's identifier via the update-in-progress endpoint.
- Given a booking is already claimed (`inProgressBy` is not `null`), then the system skips it and moves to the next booking. This includes bookings that were claimed by a human agent **and** bookings that the automation itself previously flagged for manual review (e.g., partial failures that remain claimed). The automation must never re-attempt a booking that is already claimed.
- Given a booking cycle ends (successful approval, booking-level failure with Slack notification, or skip), then the system immediately proceeds to the next eligible booking — it does not wait or stop.
- Given no pending unclaimed bookings remain in the queue, then the system waits for a configurable polling interval before fetching the queue again.

#### 5.2 Data Extraction & Translation
The system must extract passenger details, route, schedule, and class information from the Bookaway booking response and translate it into OceanJet PRIME-compatible inputs.

**Acceptance Criteria:**
- Given a booking with route "Bohol to Cebu", then the system maps origin to `TAG` and destination to `CEB` using the station code lookup table.
- Given a departure time of "13:00" in 24-hour format, then the system converts it to "1:00 PM" for PRIME selection.
- Given a Bookaway vehicle class of "Tourist Class", then the system maps it to accommodation type code `TC`. Same for "Business Class" → `BC` and "Open-Air" → `OA`.
- Given a booking with multiple passengers, then the system extracts first name, last name, age, and gender for each passenger from the `items[0].passengers` array.
- The full station code lookup table must cover all 18 unique PRIME codes (TAG, CEB, BAC, BAT, CAL, CAM, DUM, EST, GET, ILI, ILO, SIQ, ORM, PLA, TUB, MAA, SUR, PAL). Note: SIQ maps to both "Siquijor" and "Larena, Siquijor" on the Bookaway side.

#### 5.3 PRIME Desktop Automation via RPA
The system must automate the OceanJet PRIME desktop application to issue tickets. PRIME runs on a Windows VM, and the automation will use traditional RPA (e.g., UiPath, Power Automate, or similar) running on that VM to interact with the application through UI element selectors and simulated input.

**Recommended approach: Traditional RPA over AI desktop agent.** PRIME's UI has not changed in approximately 10 years, which eliminates the primary risk of selector-based RPA (UI changes breaking hardcoded selectors). Given this stability, RPA is the better fit because: (1) it is significantly faster — each action takes milliseconds via direct UI element interaction vs. several seconds per screenshot-think-act cycle with an AI agent, (2) it is fully deterministic — the same input always produces the same sequence of actions, reducing the risk of misclicks or misread ticket numbers in a financial workflow, (3) it has zero per-action API costs — no screenshots sent to an AI model on every step, and (4) mature RPA tooling provides built-in retry logic, exception handling, logging, and orchestration dashboards out of the box. The RPA bot should use partial text matching (e.g., "contains" or "starts with") when selecting options from dropdowns like voyage times, so that minor label changes (e.g., "14:00" → "14:00 A") do not cause failures. The architecture should keep the PRIME interaction layer modular so it can be swapped to an AI desktop agent (e.g., Claude Computer Use, OpenClaw) in the future if PRIME's UI undergoes a significant redesign.

**Pre-condition:** The automation assumes PRIME is already logged in and ready on the Windows VM. Login is performed manually by an agent or ops team member. The automation is **not** responsible for authenticating into PRIME.

**Acceptance Criteria:**
- Given PRIME is logged in and the automation is started, when it begins processing a booking, then it navigates to Transactions → Passage → Issue New Ticket, selects the correct trip type (One Way or Round Trip), enters the departure date, selects origin and destination station codes, picks the correct departure time from the voyage list, selects the accommodation type, and enters passenger details (first name, last name, age, sex).
- Given passenger details are entered, when the automation clicks "Issue" and confirms with "Yes", then it captures the ticket number from the success dialog before clicking "OK".
- Given a booking with N passengers, then the automation repeats the PRIME ticket issuance flow N times, collecting each ticket number.
- Given the automation detects that PRIME is logged out or the session has expired, then it immediately stops processing, sends an alert to the dedicated Slack channel (#oceanjet-automation-alerts), and does not attempt to re-login.

#### 5.4 One-Way Booking Processing
The system must handle standard one-way bookings end-to-end.

**Acceptance Criteria:**
- Given a one-way booking with 1 passenger, then the system issues 1 ticket in PRIME and approves the booking on Bookaway with the single ticket number as both the booking code and the passenger's seat number.
- Given a one-way booking with N passengers, then the system issues N tickets in PRIME and approves the booking on Bookaway with all ticket numbers space-separated in the booking code field and each ticket number assigned to its corresponding passenger's seat number field.

#### 5.5 Round-Trip Booking Processing
The system must handle round-trip bookings, issuing tickets for both the departure and return legs. PRIME has a dedicated round-trip mode (the agent selects "Round Trip" instead of "One Way"), which presents departure and return fields in a single flow.

**Acceptance Criteria:**
- Given a round-trip booking (where `misc.returnDepartureDate` and `misc.returnDepartureTime` are present), then the RPA selects "Round Trip" in PRIME and fills in both the departure and return details within PRIME's round-trip flow.
- Given a round-trip booking with N passengers, then the system issues 2×N tickets total (N for departure, N for return).
- When approving on Bookaway, the departure ticket numbers populate `departureTrip.seatsNumber` and the return ticket numbers populate `returnTrip.seatsNumber`.

#### 5.6 Connecting Route Processing
The system must handle bookings for routes that require two legs via a hub (e.g., Cebu → Siquijor via Tagbilaran). In PRIME, connecting routes are booked as two separate one-way tickets — there is no dedicated connecting route mode. The connecting routes reference table (hardcoded, schedules are fixed and rarely change) defines which routes require two legs and the departure times for each leg.

**Acceptance Criteria:**
- Given a booking for a connecting route (e.g., Cebu to Siquijor), then the system identifies it as a multi-leg route using the connecting routes lookup table and runs the one-way ticket issuance flow twice in PRIME — once for Leg 1 (CEB → TAG at 13:00) and once for Leg 2 (TAG → SIQ at 15:20).
- Given a connecting route booking with N passengers, then the system issues 2×N tickets (one per leg per passenger) for one-way connecting routes, or 4×N tickets for round-trip connecting routes (each leg of the round-trip is also a connecting route).
- All resulting ticket numbers are compiled and sent to Bookaway for approval, with proper assignment to departure and return trip fields.

#### 5.7 Bookaway Approval
After all tickets are issued in PRIME, the system must approve the booking on Bookaway via the API.

**Acceptance Criteria:**
- Given all ticket numbers have been collected for a booking, then the system calls `POST /bookings/v2/bookings/{booking_id}/approve` with `bookingCode` (all ticket numbers space-separated), and `departureTrip.seatsNumber` / `returnTrip.seatsNumber` arrays populated correctly. Note: the `approvalInputs` payload must **not** include an `_id` field — including it causes a 500 "Cast to ObjectId" error.
- Given successful approval, then the booking status changes from "Pending" to "Approved" on Bookaway.
- Given the approval API call fails, then the system retries up to 3 times before flagging for manual review.

#### 5.8 Error Handling & Manual Fallback
The system must handle failures gracefully and never leave bookings in a broken state. All failure alerts are sent to a dedicated Slack channel (e.g., #oceanjet-automation-alerts). The RPA agent must return a structured error code (see taxonomy below) so that Slack alerts are specific and actionable for agents.

**Error Code Taxonomy:**

The RPA agent classifies every failure into one of the following error codes. The orchestrator uses these to decide behavior (release vs. keep claimed, continue vs. stop) and to generate clear Slack messages.

*Booking-level errors* — the booking is released on Bookaway, a Slack alert is sent, and the automation **continues** to the next booking:

| Error Code | Description | What the agent should do |
|---|---|---|
| `STATION_NOT_FOUND` | Origin or destination station not found in PRIME's dropdown | Check if OceanJet changed station names; update station code mapping |
| `TRIP_NOT_FOUND` | No voyage listed for this station pair on the given date | Verify the route is still active; check if schedule changed |
| `TRIP_SOLD_OUT` | Voyage exists but no seats available | Book manually if alternative voyage/date available, or cancel/refund |
| `VOYAGE_TIME_MISMATCH` | No voyage matches the expected departure time | Check if OceanJet updated the schedule; book the closest available time |
| `ACCOMMODATION_UNAVAILABLE` | Requested class is sold out (other classes may have seats) | Try an alternative class if available, or cancel/refund |
| `PASSENGER_VALIDATION_ERROR` | PRIME rejected passenger details (name, age, or gender) | Review passenger data on Bookaway; fix and re-enter manually |
| `DUPLICATE_PASSENGER` | PRIME flagged passenger as already booked on this voyage | Check if a duplicate booking exists; resolve with customer |
| `DATE_BLACKOUT` | Voyage date is blocked in PRIME (holiday or maintenance) | Contact OceanJet or rebook on an alternative date |
| `PRIME_VALIDATION_ERROR` | Catch-all for unexpected PRIME validation dialogs | Screenshot the error in PRIME and investigate |
| `UNKNOWN_ERROR` | Unclassified error | Investigate the booking manually |

*System-level errors* — the booking is released, a Slack alert is sent, and the automation **stops entirely**:

| Error Code | Description | What the agent should do |
|---|---|---|
| `PRIME_TIMEOUT` | PRIME became unresponsive | Verify PRIME is running on the VM; restart if needed |
| `PRIME_CRASH` | PRIME application crashed | Restart PRIME, re-login, then restart the automation |
| `SESSION_EXPIRED` | PRIME login session has expired | Re-login to PRIME, then restart the automation |
| `RPA_INTERNAL_ERROR` | RPA agent hit an internal error | Check RPA agent logs on the Windows VM |

**Acceptance Criteria:**
- Given the RPA agent returns a booking-level error code (`STATION_NOT_FOUND`, `TRIP_NOT_FOUND`, `TRIP_SOLD_OUT`, `VOYAGE_TIME_MISMATCH`, `ACCOMMODATION_UNAVAILABLE`, `PASSENGER_VALIDATION_ERROR`, `DUPLICATE_PASSENGER`, `DATE_BLACKOUT`, `PRIME_VALIDATION_ERROR`, or `UNKNOWN_ERROR`), then the system releases the booking on Bookaway, sends a Slack alert with the booking reference, error code, human-readable description, and a link to the booking in Bookaway Admin, and **continues processing the next booking in the queue**.
- Given the RPA agent returns a system-level error code (`PRIME_TIMEOUT`, `PRIME_CRASH`, `SESSION_EXPIRED`, or `RPA_INTERNAL_ERROR`), then the system releases the booking, sends a Slack alert, and **stops the automation entirely**. An agent must resolve the issue and restart.
- Given the automation detects a PRIME logout or session expiry at any point, then it stops immediately and sends an alert to the dedicated Slack channel requesting manual re-login.
- Given a booking's departure date is more than 2 months in the future (outside PRIME's booking window), then the system skips it and re-queues it for processing when the booking window opens.
- Given a multi-passenger booking where some passengers succeed but a subsequent passenger fails in PRIME (partial failure), then the system does **not** approve the booking and does **not** release it on Bookaway. Instead, the booking remains claimed (`inProgressBy` stays set), and the system sends an alert to the dedicated Slack channel with the booking reference, which passengers succeeded (with their ticket numbers), and which passenger failed (with the failure reason and error code). An agent must manually resolve the partial state.
- The system must never approve a booking on Bookaway without having successfully issued all required tickets in PRIME.
- All Slack alerts must include the error code (e.g., `TRIP_SOLD_OUT`) alongside the human-readable description so agents can quickly identify the failure type.

---

### Nice-to-Have (P1)

These significantly improve the experience but the core automation works without them. Strong candidates for fast follow-up.

#### 5.9 Processing Dashboard & Logs
A simple dashboard or log interface where the operations team can see automation status: bookings processed, bookings failed, bookings queued, and processing time per booking.

#### 5.10 Configurable Throttling — Implemented (April 5, 2026)
The ability to configure the speed at which the bot processes bookings to avoid appearing suspicious. Implemented with two layers of pacing:
- **Inter-booking delay** (orchestrator): Random 90–180s delay after each successfully approved booking. Skipped/errored bookings proceed immediately. Configurable via `BOOKING_DELAY_MIN_MS` / `BOOKING_DELAY_MAX_MS` env vars.
- **Inter-passenger delay** (RPA agent): Random 5–15s delay between ticket issuances within the same booking. Configurable via `PASSENGER_DELAY_MIN_S` / `PASSENGER_DELAY_MAX_S` env vars.

Combined with ~1.5 min average processing time, this yields ~15 bookings/hour. This also includes the ability to run multiple bot instances in parallel, each with its own PRIME license.

#### 5.11 Notification System
Slack/email notifications for operations teams when bookings fail automation and require manual intervention, with context about the failure reason.

---

### Future Considerations (P2)

Out of scope for v1, but the architecture should not prevent these from being built later.

#### 5.12 Automated Cancellations & Modifications
Allowing Bookaway cancellation requests to push cancellations directly to OceanJet PRIME.

#### 5.13 Real-Time Inventory Syncing
Reading remaining seat capacity from PRIME to update availability on Bookaway and prevent overbooking.

#### 5.14 Multi-Operator Expansion
Adding new operators by creating a new data mapping config and operator interaction module per operator. The orchestrator and Bookaway integration remain unchanged. Each operator's interaction module can use whichever method suits their system — RPA for desktop apps, browser automation for web portals, or direct API calls where available.

#### 5.15 Events Table & Analytics Pipeline — Done (April 5, 2026)
The orchestrator publishes structured events to a BigQuery events table (`travelier-ai:oceanjet.booking_events`) via the `@google-cloud/bigquery` client. Five event types track the full booking lifecycle: `booking_claimed`, `booking_skipped`, `booking_failed`, `booking_approved`, and `poll_cycle_completed`. Failure causes are differentiated by the `error_code` field (e.g., `TRIP_SOLD_OUT`, `PRIME_CRASH`, `APPROVAL_FAILED`). Events are best-effort — failures to publish never block the main processing flow. This enables full observability: processing times, error rates by type, volume trends, and per-route success rates. Auth via service account (`oceanjet-events@travelier-ai.iam.gserviceaccount.com`) with `bigquery.dataEditor` role.

#### 5.16 AI Desktop Agent Upgrade Path
If PRIME undergoes a significant UI redesign that breaks RPA selectors, the modular PRIME interaction layer can be swapped to an AI desktop agent (e.g., Claude Computer Use API, OpenClaw) that reads the screen semantically and adapts to UI changes without reprogramming. This could also handle unexpected error dialogs or novel screen states that selector-based RPA cannot anticipate.

---

## 6. Success Metrics

### Leading Indicators (Days to Weeks Post-Launch)

| Metric | Baseline | Target | Stretch | Measurement Method |
|---|---|---|---|---|
| Automation success rate | 0% (fully manual) | 90% of bookings processed without manual intervention | 95% | Count of auto-approved bookings / total OceanJet bookings per week |
| Processing time per booking | ~10 minutes | ~2 minutes | <1 minute | Average time from booking claim to Bookaway approval |
| Fulfillment error rate | ~5% | 0% | 0% | Count of bookings with wrong passenger details, times, or routes / total processed |
| Manual intervention rate | 100% | <10% | <5% | Bookings requiring agent action / total OceanJet bookings |

### Lagging Indicators (Weeks to Months Post-Launch)

| Metric | Target | Measurement Method |
|---|---|---|
| Agent hours freed per month | ~611 hours/month (~7,333/year) | Pre vs. post automation agent time tracking |
| OceanJet booking cancellation rate (Bookaway-caused) | Decrease by >80% | Cancellations due to processing delays / total bookings |
| Customer support inquiries about pending OceanJet bookings | Decrease by >50% | Support ticket count filtered by OceanJet + pending/status |
| OceanJet partner satisfaction / rating | Improvement (qualitative) | Partner feedback |

### Evaluation Timeline
- **Week 1:** Monitor automation success rate, error rate, and processing time daily.
- **Month 1:** Evaluate all leading indicators. Decide on P1 prioritization.
- **Quarter 1:** Evaluate lagging indicators. Measure contribution to company OKR (hours freed).

---

## 7. Technical Architecture (High-Level)

### Design Principle: Modular, Operator-Agnostic Architecture

The system is designed as three independent, swappable layers. This modularity serves two purposes: (1) for OceanJet, it allows the PRIME interaction method to be changed (e.g., from RPA to AI desktop agent) without rebuilding the rest of the system, and (2) for future operators, it allows new operator modules to be added without duplicating the orchestration or Bookaway integration logic. Only the data mapping config and operator interaction module change per operator.

### System Components

```
Windows VM (both services on same machine)
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌─────────────────────────┐     ┌──────────────────────────┐  │
│  │  Orchestrator Service   │     │  PRIME RPA Agent         │  │
│  │  (Node.js/TypeScript)   │     │  (Python/pywinauto)      │  │
│  │                         │     │                          │  │
│  │  - Bookaway API client  │ HTTP│  Exposes:                │  │
│  │  - Queue polling        │────►│  POST /issue-tickets     │  │
│  │  - Data mapping         │     │  GET  /health            │  │
│  │  - Booking routing      │     │                          │  │
│  │  - Approval flow        │     │  Drives PRIME to         │  │
│  │  - Slack alerts         │     │  issue tickets and       │  │
│  │  - Logging              │     │  returns ticket #s       │  │
│  └─────────────────────────┘     └────────────┬─────────────┘  │
│                                                │                │
│                                                ▼                │
│                                   ┌──────────────────────────┐  │
│                                   │  OceanJet PRIME          │  │
│                                   │  (Desktop App)           │  │
│                                   └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Processing Flow:**

```
┌──────────┐     ┌───────────┐     ┌───────────┐     ┌───────────┐     ┌──────────┐
│  Poll    │     │  Claim    │     │ Translate │     │  Issue    │     │ Approve  │
│ Bookaway │────►│  Booking  │────►│  Data     │────►│ Tickets   │────►│ Booking  │
│  Queue   │     │           │     │ (Mapper)  │     │ (RPA/Mock)│     │ (API)    │
└──────────┘     └───────────┘     └───────────┘     └───────────┘     └──────────┘
      │                                                    │
      │              On failure:                           │
      │              ├─ Booking error → Release + Slack    │
      │              ├─ System error → Stop loop + Slack   │
      │              └─ Partial fail → Keep claimed + Slack│
      │                                                    │
      └────────────── Loop: next booking ◄─────────────────┘
```

### Layer 1: Orchestrator (Operator-Agnostic)
Handles all Bookaway API interactions (authentication, fetching pending bookings, claiming bookings via update-in-progress, fetching booking details, approving bookings) as well as scheduling, Slack alerting, logging, and error handling. This layer is the same regardless of which operator is being processed and should never contain operator-specific logic.

### Layer 2: Data Mapping Config (Per Operator)
A static configuration per operator that defines: station code mappings (e.g., "Bohol" → `TAG`), accommodation class mappings (e.g., "Tourist Class" → `TC`), time format conversions, connecting route definitions, and any operator-specific booking rules. For OceanJet, this is the lookup tables defined in section 7. For a future operator, a new config is created without touching the orchestrator or Bookaway integration.

### Layer 3: Operator Interaction Module (Per Operator, Swappable)
The "last mile" that actually issues tickets on the operator's system. For OceanJet, this is an RPA module running on a Windows VM that interacts with the PRIME desktop application through UI Automation selectors. For a future operator with a web portal, this could be a browser automation module (e.g., Playwright, Selenium). For an operator with an API, this could be a simple HTTP client. Each module exposes the same interface to the orchestrator: accept translated booking data, issue tickets, return ticket numbers (or an error).

**OceanJet PRIME module specifics:** PRIME is a standalone desktop application running on a Windows VM with no known API. The RPA bot interacts with UI elements through Windows UI Automation selectors — navigating ticket issuance, entering data into form fields, reading ticket numbers from dialog elements, and repeating for each passenger. Traditional RPA is preferred over AI desktop agents given PRIME's ~10-year track record of UI stability — selector-based automation is faster, deterministic, and cheaper to operate at scale. **Login to PRIME is handled manually by an operations agent** — the automation assumes an active, authenticated session and halts with a Slack alert if the session is lost.

### Key Technical Considerations

- **PRIME is noted as "a little bit slow."** The automation must account for variable load times with intelligent waits rather than fixed delays.
- **Each PRIME bot instance requires a separate license.** Scaling to handle peak volumes (~600 tickets/day) may require multiple parallel bot instances.
- **PRIME's 2-month booking window.** Bookings for departures >2 months out must be deferred and retried.
- **Ticket number capture uses Gemini Vision.** PRIME's success dialog is a Delphi VCL window that paints text directly on the window surface — the text is not accessible via Windows UI Automation (UIA). The RPA agent captures a screenshot of the dialog and sends it to Gemini Flash's vision API to extract the ticket number. This is the same approach used for reading the voyage schedule grid. If Gemini fails to extract the ticket number after a successful issuance (Confirm → Yes already clicked), the RPA raises `RPA_INTERNAL_ERROR` (system-level stop) to prevent duplicate tickets.

### Data Mapping Tables (Static Configuration)

**Station Codes:**

| Bookaway City (API value) | PRIME Code |
|---|---|
| Bohol | TAG |
| Tagbilaran City, Bohol Island | TAG |
| Cebu | CEB |
| Bacolod | BAC |
| Batangas | BAT |
| Calapan | CAL |
| Calapan, Mindoro Island | CAL |
| Camotes | CAM |
| Dumaguete | DUM |
| Estancia | EST |
| Bohol / Jetafe (Getafe) | GET |
| Iligan | ILI |
| Iloilo | ILO |
| Iloilo, Panay Island | ILO |
| Larena, Siquijor | SIQ |
| Ormoc | ORM |
| Ormoc, Leyte | ORM |
| Plaridel | PLA |
| Siquijor | SIQ |
| Tubigon | TUB |
| Maasin | MAA |
| Maasin City, Leyte | MAA |
| Surigao | SUR |
| Surigao City, Mindanao Island | SUR |
| Palompon, Leyte | PAL |

*Note: Some cities appear with multiple names in the Bookaway API (e.g., "Bohol" and "Tagbilaran City, Bohol Island" both map to TAG). All confirmed variants are included above.*

**Accommodation Codes:**

| Bookaway Class (API `lineClass` value) | PRIME Code |
|---|---|
| Tourist | TC |
| Business | BC |
| Open Air | OA |

*Note: The API returns `items[0].product.lineClass` with values like "Tourist" (not "Tourist Class"). See `docs/bookaway-backoffice-API-documentation-v2.md` for corrected API field paths.*

**Connecting Routes:**

| Route | Hub | Leg 1 | Leg 2 |
|---|---|---|---|
| Cebu → Siquijor | Tagbilaran | CEB → TAG @ 13:00 | TAG → SIQ @ 15:20 |
| Siquijor → Cebu | Tagbilaran | SIQ → TAG @ 08:20 | TAG → CEB @ 10:40 |
| Cebu → Dumaguete | Tagbilaran | CEB → TAG @ 08:20 | TAG → DUM @ 10:40 |
| Dumaguete → Cebu | Tagbilaran | DUM → TAG @ 13:00 | TAG → CEB @ 15:20 |
| Cebu → Surigao | Maasin | CEB → MAA @ 07:00 | MAA → SUR @ 10:30 |
| Surigao → Cebu | Maasin | SUR → MAA @ 13:00 | MAA → CEB @ 15:30 |

---

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **OceanJet objects to RPA usage on PRIME** | Medium | High — could force project shutdown | Operate the bot at human-like speeds. Do not disclose automation to OceanJet unless necessary. Have a relationship escalation plan ready. |
| **PRIME UI changes break the RPA selectors** | Low (UI unchanged for ~10 years) | High — automation stops working | RPA selectors use partial text matching where possible to tolerate minor label changes. The modular architecture allows the PRIME interaction layer to be swapped to an AI desktop agent if a major UI redesign ever occurs. Monitor for failures via Slack alerts and maintain manual fallback. |
| **PRIME latency/timeouts cause failures** | High | Medium — bookings fall back to manual | Implement intelligent retry logic with exponential backoff. Set conservative timeouts. Log all timing data. |
| **Peak volume exceeds single bot capacity** | Medium | Medium — processing delays | Design for multi-bot parallelism from day one. Each bot uses its own PRIME license. |
| **Connecting route logic errors** | Low | High — wrong tickets issued | Hardcode connecting route table with strict validation. Log every leg separately. Include connecting route test cases in QA. |
| **Booking window timing issues** | Low | Low — bookings deferred | Implement date-check logic: skip bookings with departure > 2 months out, re-queue for daily retry. |

---

## 9. Open Questions

### Resolved

| # | Question | Resolution |
|---|---|---|
| 1 | Is the round-trip booking flow in PRIME identical to one-way, or a dedicated mode? | **Dedicated round-trip mode.** PRIME has a separate "Round Trip" selection that presents both departure and return fields in one flow. Updated in section 5.5. |
| 2 | How does PRIME handle connecting routes? | **Two separate one-way tickets.** There is no connecting route mode in PRIME. Each leg is booked independently. Updated in section 5.6. |
| 3 | What is the maximum safe throughput for PRIME? | **Target: ~60 tickets/hour (1 per minute).** No known system-imposed limits, but starting conservative. A single bot can handle ~480 tickets in an 8-hour window. |
| 4 | How many PRIME licenses are available? | **Easy to get more.** Additional licenses can be requested from OceanJet at low/no cost. Scaling with parallel bots is not constrained by licensing. |
| 5 | What is OceanJet's policy on bot access to PRIME? | **Operating quietly.** No discussion with OceanJet planned. The bot should behave at human-like speed and pacing. Implemented via configurable inter-booking delays (90–180s after approved bookings) and inter-passenger delays (5–15s between tickets). Target throughput: ~15 bookings/hour. |
| 6 | Are connecting route schedules fixed or changing? | **Fixed / rarely change.** A hardcoded lookup table is sufficient. |
| 7 | Are there booking types beyond one-way, round-trip, and connecting routes? | **No.** These three cover all bookings in the OceanJet queue. |
| 8 | What happens on partial failure (some passengers succeed, one fails)? | **Hold and alert.** The booking stays claimed on Bookaway (not released, not approved). An alert is sent to Slack with details on which passengers succeeded and which failed. Agent resolves manually. Updated in section 5.8. |

### Still Open

No blocking questions remain.

### Recently Resolved

| # | Question | Resolution |
|---|---|---|
| 9 | Does PRIME return 1 or 2 ticket numbers for a round-trip booking? | **2 tickets per passenger**, comma-separated in one dialog: `[13023072,13023073]`. First = departure, second = return. Booking code contains all tickets; `departureTrip.seatsNumber` and `returnTrip.seatsNumber` each get one ticket per passenger. |

---

## 10. Timeline Considerations

- **No hard external deadline**, but the initiative directly supports a company OKR for the current period.
- **Dependency:** Engineering needs access to a PRIME test environment (or test account) to develop and validate the RPA automation.
- **Actual phasing (updated to reflect implementation):**
  - **Phase 1 (Complete):** TypeScript orchestrator — Bookaway API client, data mapper (all 4 booking types), booking processor, polling loop, Slack alerts, mock operator. 47 unit tests passing.
  - **Phase 2 (Complete):** Python RPA agent — pywinauto + Gemini Vision driving PRIME desktop app. Form fill, voyage selection, ticket issuance, ticket number capture, print preview handling, error detection (11/12 error codes). First production E2E booking completed March 22, 2026.
  - **Phase 2.5 (Complete):** Multi-passenger RPA optimizations (March 31, 2026) — voyage-only mode skips redundant trip field filling for pax 2+ on same leg; Gemini Vision cache reuses parsed grid rows by route+date; print preview close only loops for expected count. Saves ~3-4s per skipped Gemini call and ~2s per skipped trip fill.
  - **Phase 3 (In Progress):** Multi-booking continuous mode with human-like pacing (April 5–6, 2026) — inter-booking delays (90–180s after approved bookings), inter-passenger delays (5–15s), sold-out popup detection via Gemini Vision with seat availability reporting, first-cycle validation guard removed, BigQuery events table for lifecycle tracking (5 event types), TRIP_NOT_FOUND 24h cooldown to prevent retry loops, graceful stop command. SESSION_EXPIRED detection still remaining.
- All 4 booking types (one-way, round-trip, connecting-one-way, connecting-round-trip) are supported and validated in production.

---

## Appendix A: Current Manual Workflow Summary

For full details, see `OceanJet-Bookaway-current-manual-booking-flow.md`.

The current process spans 5 phases across 2 systems (Bookaway Admin + PRIME Desktop):

1. **System Access & Queue Management** — Agent logs into both systems, filters for pending OceanJet bookings.
2. **Booking Selection & Locking** — Agent claims an available booking via the "At Work" checkbox.
3. **Data Translation & PRIME Entry** — Agent manually translates station names to codes, converts 24h to 12h time, maps class names to codes, and enters passenger details one at a time.
4. **Ticket Issuance & Temporary Storage** — Agent issues ticket in PRIME, frantically copies the ticket number before the dialog disappears, pastes it into a temporary Notepad/Excel file.
5. **Bookaway Approval** — Agent returns to Bookaway, enters ticket numbers into the approval modal, and approves the booking.

This cycle repeats for every passenger in every booking, ~101,000 times per year.

---

## Appendix B: Reference Documents

- **Bookaway Backoffice API Documentation (Corrected):** `docs/bookaway-backoffice-API-documentation-v2.md` — based on live API validation, corrects field paths from original doc
- **OceanJet Inventory Reference Sheet:** `docs/oceanjet-inventory-reference-sheet.md`
- **System Design:** `docs/system-design.md` — Architecture, API contract, processing flow, PRIME UI details
- **Implementation Status:** `docs/implementation-status.md` — current build progress and next steps

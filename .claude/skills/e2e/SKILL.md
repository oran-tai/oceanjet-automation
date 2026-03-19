---
name: e2e
description: Runs an end-to-end staging test for the OceanJet booking automation against the Bookaway staging API. Tests the full pipeline - login, fetch bookings, claim, translate, approve, and verify. Use when user says "/e2e", "run e2e", "run e2e test", "test staging", "test the booking flow", "run the staging test", "verify the approval API", or "test the full pipeline". Accepts an optional booking reference argument.
---

# E2E Staging Test

Runs the full Bookaway API flow against staging to verify the orchestrator pipeline works end-to-end. This approves a real staging booking with fake ticket numbers, so it must never run against production.

## Instructions

### Step 1: Safety check

Read the `.env` file in the project root and verify `BOOKAWAY_ENV` is set to `stage` (not `prod`). If it's set to `prod`, stop immediately and tell the user:

> BOOKAWAY_ENV is set to "prod". This test approves real bookings with fake ticket numbers and would corrupt production data. Change it to "stage" in .env before running.

Do not proceed until the environment is confirmed as staging.

### Step 2: Run the test script

Run the E2E test from the project root using `npx tsx tests/e2e-staging.ts`.

If the user provided a booking reference (e.g., `/e2e BW3543919`), pass it as an argument:

```bash
npx tsx tests/e2e-staging.ts BW3543919
```

If no reference was provided, run without arguments to auto-pick the first unclaimed booking:

```bash
npx tsx tests/e2e-staging.ts
```

Use a 60-second timeout since the script makes multiple API calls.

### Step 3: Report results

The script outputs step-by-step progress. Summarize the results for the user:

**If the script exits with code 0** — report success, including:
- Which booking was tested (reference number)
- The route, booking type, and passenger count
- That all 9 steps passed

**If the script exits with code 1** — report which step failed, the error message, and whether the booking was successfully released (the script auto-releases on failure). Suggest a fix based on the troubleshooting table below.

## What the test covers

| Step | Action | Verifies |
|------|--------|----------|
| 1 | Login | Credentials and staging API URL work |
| 2 | Fetch pending bookings | Bookaway API query with OceanJet supplier filter |
| 3 | Pick booking | Booking selection (specific ref or first unclaimed) |
| 4 | Claim booking | update-in-progress API sets inProgressBy |
| 5 | Fetch details | Booking detail endpoint returns full data |
| 6 | Translate | OceanJet mapper handles station codes, times, classes, booking type |
| 7 | Build payload | Approval payload structure with fake tickets |
| 8 | Approve | Approval API accepts the payload |
| 9 | Verify status | Booking status changed to "approved" |

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| ABORT: BOOKAWAY_ENV is set to "prod" | .env has `BOOKAWAY_ENV=prod` | Change to `BOOKAWAY_ENV=stage` in `.env` |
| No pending bookings in staging queue | Staging has no pending OceanJet bookings | Create a test booking on staging first |
| All bookings are claimed | Every pending booking has an inProgressBy value | Release a booking on staging admin, or pass a specific reference |
| Booking BW... not found in pending queue | The specified reference isn't in the pending queue | Check the reference is correct and the booking is still pending |
| HTTP 401 on login | Bad credentials | Check `BOOKAWAY_USERNAME` and `BOOKAWAY_PASSWORD` in `.env` |
| HTTP 500 on approve | Payload structure wrong | Check `docs/bookaway-backoffice-API-documentation-v2.md` for the correct approval format |
| Unknown origin/destination city | A Bookaway city name isn't in the station code mapping | Add the city to `src/operators/oceanjet/config.ts` STATION_CODES |
| Unknown accommodation class | A lineClass value isn't mapped | Add it to `src/operators/oceanjet/config.ts` ACCOMMODATION_CODES |

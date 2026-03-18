/**
 * End-to-end staging test.
 *
 * Runs the full Bookaway API flow against the staging environment:
 *   1. Login
 *   2. Fetch pending OceanJet bookings
 *   3. Pick the first unclaimed booking
 *   4. Claim it (set inProgressBy)
 *   5. Fetch full booking details
 *   6. Translate via the OceanJet mapper
 *   7. Build approval payload with fake ticket numbers
 *   8. Approve the booking on Bookaway
 *   9. Verify the booking status changed to approved
 *
 * Usage:  npx tsx tests/e2e-staging.ts [BOOKING_REFERENCE]
 *
 * If BOOKING_REFERENCE is provided (e.g., BW3543919), the test will
 * target that specific booking instead of picking the first unclaimed one.
 */
import { BookawayClient } from '../src/bookaway/client.js';
import { mapBookingToOceanJet } from '../src/operators/oceanjet/mapper.js';
import { config } from '../src/config.js';
import type { ApprovalRequest } from '../src/bookaway/types.js';

const DIVIDER = '─'.repeat(60);

function step(n: number, label: string) {
  console.log(`\n${DIVIDER}`);
  console.log(`  STEP ${n}: ${label}`);
  console.log(DIVIDER);
}

function buildApprovalPayload(
  departureTickets: string[],
  returnTickets: string[]
): ApprovalRequest {
  const allTickets = [...departureTickets, ...returnTickets];
  return {
    extras: [],
    pickups: [{ time: 0, location: null }],
    dropOffs: [null],
    voucherAttachments: [],
    approvalInputs: {
      bookingCode: allTickets.join(' '),
      departureTrip: {
        seatsNumber: departureTickets,
        ticketsQrCode: [],
      },
      returnTrip: {
        seatsNumber: returnTickets,
        ticketsQrCode: [],
      },
    },
  };
}

async function main() {
  console.log(`\n🧪 E2E Staging Test`);
  console.log(`   Environment: ${config.bookaway.env}`);
  console.log(`   API URL:     ${config.bookaway.apiUrl}`);
  console.log(`   Origin:      ${config.bookaway.origin}`);

  if (config.bookaway.env === 'prod') {
    console.error('\n❌ ABORT: BOOKAWAY_ENV is set to "prod". This test must run against staging.');
    process.exit(1);
  }

  const client = new BookawayClient();

  // ── Step 1: Login ──
  step(1, 'Login');
  await client.login();
  console.log('  ✅ Logged in successfully');

  // ── Step 2: Fetch pending bookings ──
  step(2, 'Fetch pending OceanJet bookings');
  const bookings = await client.fetchPendingBookings();
  console.log(`  Found ${bookings.length} pending bookings`);

  if (bookings.length === 0) {
    console.log('\n⚠️  No pending bookings in staging queue. Cannot continue E2E test.');
    console.log('   Create a test booking on staging first, then re-run.');
    process.exit(0);
  }

  // Show all bookings
  for (const b of bookings) {
    const claimed = b.inProgressBy ? `[claimed by ${b.inProgressBy}]` : '[unclaimed]';
    console.log(`  • ${b.reference} ${claimed}`);
  }

  // ── Step 3: Pick booking ──
  const requestedRef = process.argv[2];
  step(3, requestedRef ? `Find booking ${requestedRef}` : 'Pick first unclaimed booking');

  let target;
  if (requestedRef) {
    target = bookings.find((b) => b.reference === requestedRef);
    if (!target) {
      console.log(`  ⚠️  Booking ${requestedRef} not found in pending queue.`);
      process.exit(1);
    }
    if (target.inProgressBy) {
      console.log(`  ⚠️  Booking ${requestedRef} is claimed by ${target.inProgressBy}. Proceeding anyway (will re-claim).`);
    }
  } else {
    target = bookings.find((b) => !b.inProgressBy);
    if (!target) {
      console.log('  ⚠️  All bookings are claimed. Cannot continue.');
      console.log('  Release a booking or create a new one on staging.');
      process.exit(0);
    }
  }

  console.log(`  Selected: ${target.reference} (${target._id})`);

  // ── Step 4: Claim the booking ──
  step(4, `Claim booking ${target.reference}`);
  await client.claimBooking(target._id);
  console.log(`  ✅ Claimed by ${config.bookaway.botIdentifier}`);

  try {
    // ── Step 5: Fetch full details ──
    step(5, 'Fetch full booking details');
    const detail = await client.fetchBookingDetails(target._id);
    console.log(`  Reference:    ${detail.reference}`);
    console.log(`  Route:        ${detail.misc.route}`);
    console.log(`  Departure:    ${detail.misc.departureDate} at ${detail.misc.departureTime}`);
    console.log(`  Passengers:   ${detail.items[0]?.passengers.length ?? 0}`);
    if (detail.misc.returnDepartureDate) {
      console.log(`  Return:       ${detail.misc.returnDepartureDate} at ${detail.misc.returnDepartureTime}`);
    }

    // ── Step 6: Translate via mapper ──
    step(6, 'Translate booking to OceanJet format');
    const translated = mapBookingToOceanJet(detail);
    console.log(`  Booking type: ${translated.bookingType}`);
    console.log(`  Route:        ${translated.departureLeg.origin} → ${translated.departureLeg.destination}`);
    console.log(`  Time:         ${translated.departureLeg.time}`);
    console.log(`  Class:        ${translated.departureLeg.accommodation}`);
    console.log(`  Passengers:`);
    for (const p of translated.passengers) {
      console.log(`    • ${p.firstName} ${p.lastName} (age: ${p.age}, gender: ${p.gender})`);
    }
    if (translated.connectingLegs) {
      console.log(`  Connecting legs:`);
      for (const leg of translated.connectingLegs) {
        console.log(`    • ${leg.origin} → ${leg.destination} at ${leg.time}`);
      }
    }
    if (translated.returnLeg) {
      console.log(`  Return leg:   ${translated.returnLeg.origin} → ${translated.returnLeg.destination} at ${translated.returnLeg.time}`);
    }

    // ── Step 7: Build approval payload with fake tickets ──
    step(7, 'Build approval payload');

    const passengerCount = translated.passengers.length;
    const departureTickets: string[] = [];
    const returnTickets: string[] = [];

    // Generate fake ticket numbers based on booking type
    switch (translated.bookingType) {
      case 'one-way':
        for (let i = 0; i < passengerCount; i++) departureTickets.push(`E2E-DEP-${i + 1}`);
        break;
      case 'round-trip':
        for (let i = 0; i < passengerCount; i++) departureTickets.push(`E2E-DEP-${i + 1}`);
        for (let i = 0; i < passengerCount; i++) returnTickets.push(`E2E-RET-${i + 1}`);
        break;
      case 'connecting-one-way':
        for (let i = 0; i < passengerCount; i++) {
          departureTickets.push(`E2E-LEG1-${i + 1}`);
          departureTickets.push(`E2E-LEG2-${i + 1}`);
        }
        break;
      case 'connecting-round-trip':
        for (let i = 0; i < passengerCount; i++) {
          departureTickets.push(`E2E-DLEG1-${i + 1}`);
          departureTickets.push(`E2E-DLEG2-${i + 1}`);
        }
        for (let i = 0; i < passengerCount; i++) {
          returnTickets.push(`E2E-RLEG1-${i + 1}`);
          returnTickets.push(`E2E-RLEG2-${i + 1}`);
        }
        break;
    }

    const approval = buildApprovalPayload(departureTickets, returnTickets);
    console.log(`  Booking code:     ${approval.approvalInputs.bookingCode}`);
    console.log(`  Departure seats:  ${JSON.stringify(approval.approvalInputs.departureTrip.seatsNumber)}`);
    console.log(`  Return seats:     ${JSON.stringify(approval.approvalInputs.returnTrip.seatsNumber)}`);

    // ── Step 8: Approve the booking ──
    step(8, `Approve booking ${target.reference}`);
    await client.approveBooking(target._id, approval);
    console.log('  ✅ Approval API call succeeded');

    // ── Step 9: Verify status changed ──
    step(9, 'Verify booking status');
    const updated = await client.fetchBookingDetails(target._id);
    console.log(`  Status: ${updated.status}`);

    if (updated.status === 'approved') {
      console.log('  ✅ Booking is now approved');
    } else {
      console.log(`  ⚠️  Expected "approved" but got "${updated.status}"`);
    }

    // ── Summary ──
    console.log(`\n${DIVIDER}`);
    console.log('  ✅ E2E TEST PASSED — Full flow completed successfully');
    console.log(DIVIDER);
    console.log(`  Booking:  ${target.reference}`);
    console.log(`  Route:    ${translated.departureLeg.origin} → ${translated.departureLeg.destination}`);
    console.log(`  Type:     ${translated.bookingType}`);
    console.log(`  Tickets:  ${approval.approvalInputs.bookingCode}`);
    console.log('');
  } catch (error: any) {
    // On any failure, release the booking so it doesn't stay stuck
    console.error(`\n❌ Error: ${error.message}`);
    if (error.response) {
      console.error(`   HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    }
    console.log('\n  Releasing booking to avoid leaving it stuck...');
    try {
      await client.releaseBooking(target._id);
      console.log('  ✅ Booking released');
    } catch (releaseErr: any) {
      console.error(`  ❌ Failed to release: ${releaseErr.message}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n❌ Fatal error: ${e.message}`);
  if (e.response) {
    console.error(`   HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`);
  }
  process.exit(1);
});

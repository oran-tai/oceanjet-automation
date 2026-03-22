import { BookawayClient } from '../src/bookaway/client.js';
import { mapBookingToOceanJet } from '../src/operators/oceanjet/mapper.js';
import '../src/config.js';

async function main() {
  const client = new BookawayClient();
  await client.login();

  const bookings = await client.fetchPendingBookings();
  console.log(`\n=== ${bookings.length} PENDING BOOKINGS ===\n`);

  // Try to map the first 10 bookings to verify the mapper works
  let success = 0;
  let failed = 0;
  for (const b of bookings.slice(0, 10)) {
    try {
      const detail = await client.fetchBookingDetails(b._id);
      const translated = mapBookingToOceanJet(detail);
      console.log(
        `OK  ${detail.reference} | ${detail.misc.route} | ` +
        `${translated.bookingType} | ${translated.departureLeg.origin}→${translated.departureLeg.destination} | ` +
        `${translated.passengers.length} pax | ${translated.departureLeg.accommodation} | ` +
        `${translated.departureLeg.time}`
      );
      success++;
    } catch (e: any) {
      console.log(`ERR ${b.reference} | ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${success} OK, ${failed} failed ===`);
}

main().catch((e) => console.error('ERROR:', e.message));

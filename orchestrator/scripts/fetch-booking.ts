/**
 * Fetch a single booking by reference, show details and translated output.
 * Usage: npx tsx scripts/fetch-booking.ts BW4936615
 */
import { BookawayClient } from '../src/bookaway/client.js';
import { config } from '../src/config.js';
import { mapBookingToOceanJet } from '../src/operators/oceanjet/mapper.js';

const reference = process.argv[2] || config.targetBooking;
if (!reference) {
  console.error('Usage: npx tsx scripts/fetch-booking.ts <REFERENCE>');
  process.exit(1);
}

async function main() {
  const client = new BookawayClient(config.bookaway);
  await client.login();
  console.log(`Logged in to Bookaway (${config.bookaway.env})\n`);

  const bookings = await client.fetchPendingBookings();
  const target = bookings.find(b => b.reference === reference);

  if (!target) {
    console.log(`Booking ${reference} not found in pending queue.`);
    console.log(`Pending bookings: ${bookings.map(b => b.reference).join(', ') || '(none)'}`);
    return;
  }

  console.log('=== Booking Summary ===');
  console.log(JSON.stringify(target, null, 2));

  const details = await client.getBookingDetails(target._id);
  console.log('\n=== Full Details ===');
  console.log(JSON.stringify(details, null, 2));

  const translated = mapBookingToOceanJet(details);
  console.log('\n=== Translated for PRIME ===');
  console.log(JSON.stringify(translated, null, 2));
}

main().catch(console.error);

import { BookawayClient } from '../src/bookaway/client.js';
import '../src/config.js';

async function main() {
  const client = new BookawayClient();
  await client.login();

  const bookings = await client.fetchPendingBookings();
  const target = bookings.find((b) => !b.inProgressBy);
  if (!target) { console.log('No unclaimed bookings'); return; }

  const detail = await client.fetchBookingDetails(target._id);
  console.log(JSON.stringify(detail, null, 2));
}

main().catch((e) => console.error('ERROR:', e.message));

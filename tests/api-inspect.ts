import { BookawayClient } from '../src/bookaway/client.js';
import '../src/config.js';

async function main() {
  const client = new BookawayClient();
  await client.login();

  const bookings = await client.fetchPendingBookings();

  // Log the first booking summary raw shape
  console.log('\n=== RAW BOOKING SUMMARY (first) ===');
  console.log(JSON.stringify(bookings[0], null, 2));

  // Fetch detail and log raw
  if (bookings.length > 0) {
    const detail = await (client as any).client.get(`/bookings/bookings/${bookings[0]._id}`);
    console.log('\n=== RAW BOOKING DETAIL KEYS ===');
    const data = detail.data;
    console.log('Top-level keys:', Object.keys(data));
    console.log('\nitems type:', typeof data.items, 'isArray:', Array.isArray(data.items), 'length:', data.items?.length);
    if (data.items && data.items.length > 0) {
      console.log('\nitems[0] keys:', Object.keys(data.items[0]));
      console.log('\nitems[0].product keys:', data.items[0].product ? Object.keys(data.items[0].product) : 'no product');
      console.log('\nitems[0].passengers sample:', JSON.stringify(data.items[0].passengers?.[0], null, 2));
    } else {
      console.log('\nNo items array or empty. Checking other fields...');
      // Check if data has products, legs, or other structures
      for (const key of Object.keys(data)) {
        const val = data[key];
        if (val && typeof val === 'object') {
          console.log(`  ${key}: ${Array.isArray(val) ? `array[${val.length}]` : 'object'}`);
        }
      }
    }

    // Dump a compact version of the full response
    console.log('\n=== FULL DETAIL (truncated) ===');
    console.log(JSON.stringify(data, null, 2).slice(0, 5000));
  }
}

main().catch((e) => console.error('ERROR:', e.message));

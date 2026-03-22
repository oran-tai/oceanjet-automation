import { BookawayClient } from '../src/bookaway/client.js';
import '../src/config.js';

async function main() {
  const client = new BookawayClient();
  await client.login();

  const bookings = await client.fetchPendingBookings();

  // Check first 3 bookings for item _id in both list and detail responses
  for (const b of bookings.slice(0, 3)) {
    // Raw list item
    console.log(`\n=== ${b.reference} (list) ===`);
    const listItem = (b as any).items?.[0];
    console.log('  item._id:', listItem?._id);
    console.log('  item.reference:', listItem?.reference);

    // Raw detail item
    const detail = await (client as any).client.get(`/bookings/bookings/${b._id}`);
    const detailItem = detail.data.items?.[0];
    console.log(`=== ${b.reference} (detail) ===`);
    console.log('  item._id:', detailItem?._id);
    console.log('  item.reference:', detailItem?.reference);
    console.log('  item.product._id:', detailItem?.product?._id);

    // Dump ALL keys on the detail item (including hidden/prototype)
    console.log('  All own keys:', Object.keys(detailItem || {}));

    // Check if _id is in the raw JSON string
    const rawStr = JSON.stringify(detailItem).slice(0, 200);
    console.log('  Raw start:', rawStr);
  }
}

main().catch((e) => console.error('ERROR:', e.message));

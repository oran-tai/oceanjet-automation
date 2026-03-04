import { BookawayClient } from '../src/bookaway/client.js';
import '../src/config.js';

async function main() {
  const client = new BookawayClient();
  await client.login();

  const bookings = await client.fetchPendingBookings();
  if (bookings.length === 0) { console.log('No bookings'); return; }

  const detail = await (client as any).client.get(`/bookings/bookings/${bookings[0]._id}`);
  const data = detail.data;
  const item = data.items[0];

  // Check misc for route data
  console.log('\n=== MISC ===');
  console.log(JSON.stringify(data.misc, null, 2));

  // Check item.trip
  console.log('\n=== ITEM.TRIP ===');
  console.log(JSON.stringify(item.trip, null, 2));

  // Check item.journey
  console.log('\n=== ITEM.JOURNEY ===');
  console.log(JSON.stringify(item.journey, null, 2));

  // Check item.transferData
  console.log('\n=== ITEM.TRANSFER_DATA ===');
  console.log(JSON.stringify(item.transferData, null, 2));

  // Check for _id on item (needed for approval)
  console.log('\n=== ITEM IDENTIFIERS ===');
  console.log('item._id:', item._id);
  console.log('item.reference:', item.reference);
  console.log('item.product._id:', item.product._id);

  // Check item.itemApprovalInputs
  console.log('\n=== ITEM.itemApprovalInputs ===');
  console.log(JSON.stringify(item.itemApprovalInputs, null, 2));

  // Check passengers structure
  console.log('\n=== ALL PASSENGERS ===');
  console.log(JSON.stringify(item.passengers, null, 2));

  // Check all top level item keys with values
  console.log('\n=== ITEM SEATS ===');
  console.log('seats:', JSON.stringify(item.seats));
  console.log('seatsType:', item.seatsType);

  // Look at booking summary tripInfo
  console.log('\n=== BOOKING SUMMARY ITEMS[0] KEYS ===');
  const summaryItem = bookings[0].items[0];
  console.log(JSON.stringify(summaryItem, null, 2).slice(0, 3000));
}

main().catch((e) => console.error('ERROR:', e.message));

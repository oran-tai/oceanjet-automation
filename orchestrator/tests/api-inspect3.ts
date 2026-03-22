import { BookawayClient } from '../src/bookaway/client.js';
import '../src/config.js';

async function main() {
  const client = new BookawayClient();
  await client.login();

  const bookings = await client.fetchPendingBookings();

  // Collect unique city names and lineClasses
  const cities = new Set<string>();
  const lineClasses = new Set<string>();
  const routes = new Set<string>();

  const toCheck = bookings.slice(0, 20);
  for (const b of toCheck) {
    const detail = await (client as any).client.get(`/bookings/bookings/${b._id}`);
    const data = detail.data;
    const item = data.items[0];

    if (item?.trip?.fromId?.city?.name) cities.add(item.trip.fromId.city.name);
    if (item?.trip?.toId?.city?.name) cities.add(item.trip.toId.city.name);
    if (item?.product?.lineClass) lineClasses.add(item.product.lineClass);
    routes.add(data.misc.route);

    // Check for round trips
    if (data.misc.returnDepartureDate) {
      console.log(`ROUND TRIP: ${data.reference} — ${data.misc.route}`);
      console.log(`  Return: ${data.misc.returnDepartureDate} ${data.misc.returnDepartureTime}`);
    }
  }

  console.log('\n=== UNIQUE CITY NAMES FROM API ===');
  [...cities].sort().forEach(c => console.log(`  "${c}"`));

  console.log('\n=== UNIQUE LINE CLASSES ===');
  [...lineClasses].sort().forEach(c => console.log(`  "${c}"`));

  console.log('\n=== UNIQUE ROUTES ===');
  [...routes].sort().forEach(r => console.log(`  "${r}"`));
}

main().catch((e) => console.error('ERROR:', e.message));

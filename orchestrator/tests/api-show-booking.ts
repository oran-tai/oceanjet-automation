import { BookawayClient } from '../src/bookaway/client.js';
import { mapBookingToOceanJet } from '../src/operators/oceanjet/mapper.js';
import '../src/config.js';

async function main() {
  const client = new BookawayClient();
  await client.login();

  const bookings = await client.fetchPendingBookings();
  // Pick the first unclaimed booking
  const target = bookings.find((b) => !b.inProgressBy);
  if (!target) { console.log('No unclaimed bookings'); return; }

  const detail = await client.fetchBookingDetails(target._id);

  console.log('=== BOOKING DETAIL ===');
  console.log('Booking ID:  ', detail._id);
  console.log('Reference:   ', detail.reference);
  console.log('Status:      ', detail.status);
  console.log('In Progress: ', detail.inProgressBy || 'none');
  console.log('');
  console.log('--- Route & Schedule ---');
  console.log('Route:       ', detail.misc.route);
  console.log('Departure:   ', detail.misc.departureDate, 'at', detail.misc.departureTime);
  console.log('Return:      ', detail.misc.returnDepartureDate || 'N/A', detail.misc.returnDepartureTime || '');
  console.log('');
  console.log('--- Contact ---');
  console.log('Email:       ', detail.contact.email);
  console.log('Phone:       ', detail.contact.phone);
  console.log('');

  const item = detail.items[0];
  console.log('--- Item ---');
  console.log('Item Ref:    ', item.reference);
  console.log('Product ID:  ', item.product._id);
  console.log('Line Class:  ', item.product.lineClass);
  console.log('Origin:      ', item.trip.fromId.city.name, `(${item.trip.fromId.address})`);
  console.log('Destination: ', item.trip.toId.city.name, `(${item.trip.toId.address})`);
  console.log('');

  console.log('--- Passengers ---');
  item.passengers.forEach((p, i) => {
    const age = p.extraInfos?.find((e) => e.definition === '58f47da902e97f000888b000')?.value || '?';
    const gender = p.extraInfos?.find((e) => e.definition === '58f47db102e97f000888b001')?.value || '?';
    console.log(`  [${i + 1}] ${p.firstName} ${p.lastName} | Age: ${age} | Gender: ${gender}`);
  });

  console.log('');
  console.log('=== MAPPER OUTPUT ===');
  const translated = mapBookingToOceanJet(detail);
  console.log('Booking Type:', translated.bookingType);
  console.log('Item ID:     ', translated.itemId);
  console.log('Departure:   ', `${translated.departureLeg.origin} → ${translated.departureLeg.destination} | ${translated.departureLeg.date} ${translated.departureLeg.time} | ${translated.departureLeg.accommodation}`);
  if (translated.returnLeg) {
    console.log('Return:      ', `${translated.returnLeg.origin} → ${translated.returnLeg.destination} | ${translated.returnLeg.date} ${translated.returnLeg.time}`);
  }
  if (translated.connectingLegs) {
    console.log('Connecting:');
    translated.connectingLegs.forEach((leg, i) => {
      console.log(`  Leg ${i + 1}:    ${leg.origin} → ${leg.destination} | ${leg.date} ${leg.time}`);
    });
  }
  console.log('Passengers:');
  translated.passengers.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.firstName} ${p.lastName} | Age: ${p.age} | Gender: ${p.gender}`);
  });
}

main().catch((e) => console.error('ERROR:', e.message));

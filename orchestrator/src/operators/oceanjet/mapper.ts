import type { BookingDetail } from '../../bookaway/types.js';
import type {
  TranslatedBooking,
  PassengerData,
  LegData,
  BookingType,
} from '../types.js';
import {
  resolveStationFromLocation,
  resolveAccommodationCode,
  findConnectingRoute,
} from './config.js';
import { to12Hour } from '../../utils/time.js';

/** Known extra info definition IDs from Bookaway */
const EXTRA_INFO_IDS = {
  AGE: '58f47da902e97f000888b000',
  GENDER: '58f47db102e97f000888b001',
};

/**
 * Extract age from passenger's extraInfos array.
 */
function extractAge(passenger: BookingDetail['items'][0]['passengers'][0]): string {
  if (!passenger.extraInfos) return 'Unknown';
  const ageInfo = passenger.extraInfos.find(
    (info) => info.definition === EXTRA_INFO_IDS.AGE
  );
  return ageInfo?.value || 'Unknown';
}

/**
 * Extract gender from passenger's extraInfos array.
 */
function extractGender(passenger: BookingDetail['items'][0]['passengers'][0]): string {
  if (!passenger.extraInfos) return 'Unknown';
  const genderInfo = passenger.extraInfos.find(
    (info) => info.definition === EXTRA_INFO_IDS.GENDER
  );
  return genderInfo?.value || 'Unknown';
}

/**
 * Resolve the accommodation code from a booking item.
 * Uses product.lineClass (e.g., "Tourist", "Business", "Open Air").
 */
function resolveAccommodation(item: BookingDetail['items'][0]): string {
  const className = item.product.lineClass || '';
  const code = resolveAccommodationCode(className);
  if (!code) {
    throw new Error(
      `Unknown accommodation class: "${className}"`
    );
  }
  return code;
}

/**
 * Maps a Bookaway booking detail to the OceanJet translated format.
 * Automatically detects booking type: one-way, round-trip, connecting, or connecting-round-trip.
 */
export function mapBookingToOceanJet(booking: BookingDetail): TranslatedBooking {
  const item = booking.items[0];
  if (!item) {
    throw new Error(`Booking ${booking.reference} has no items`);
  }

  // Extract origin/destination from item.trip (actual API path)
  const originCode = resolveStationFromLocation(item.trip.fromId);
  const destinationCode = resolveStationFromLocation(item.trip.toId);

  if (!originCode) {
    throw new Error(
      `Unknown origin city: "${item.trip.fromId.city.name}" (booking ${booking.reference})`
    );
  }
  if (!destinationCode) {
    throw new Error(
      `Unknown destination city: "${item.trip.toId.city.name}" (booking ${booking.reference})`
    );
  }

  // Extract passengers — age and gender are in extraInfos by definition ID
  const passengers: PassengerData[] = item.passengers.map((p) => ({
    firstName: p.firstName,
    lastName: p.lastName,
    age: extractAge(p),
    gender: extractGender(p),
  }));

  // Extract accommodation from product.lineClass
  const accommodation = resolveAccommodation(item);

  // Check if round-trip (returnDepartureDate is empty string when not round-trip)
  const isRoundTrip = !!(
    booking.misc.returnDepartureDate && booking.misc.returnDepartureTime
  );

  // Check if connecting route
  const connectingRoute = findConnectingRoute(originCode, destinationCode);

  // Determine booking type
  let bookingType: BookingType;
  if (connectingRoute && isRoundTrip) {
    bookingType = 'connecting-round-trip';
  } else if (connectingRoute) {
    bookingType = 'connecting-one-way';
  } else if (isRoundTrip) {
    bookingType = 'round-trip';
  } else {
    bookingType = 'one-way';
  }

  const result: TranslatedBooking = {
    bookingId: booking._id,
    reference: booking.reference,
    bookingType,
    passengers,
    contactInfo: item.passengers[0]?.contact?.email || '',
    departureLeg: {
      origin: originCode,
      destination: destinationCode,
      date: booking.misc.departureDate,
      time: to12Hour(booking.misc.departureTime),
      accommodation,
    },
  };

  // Add return leg for round-trip (non-connecting)
  if (isRoundTrip && !connectingRoute) {
    result.returnLeg = {
      origin: destinationCode,
      destination: originCode,
      date: booking.misc.returnDepartureDate!,
      time: to12Hour(booking.misc.returnDepartureTime!),
      accommodation,
    };
  }

  // Add connecting legs
  if (connectingRoute) {
    result.connectingLegs = [
      {
        origin: connectingRoute.leg1.origin,
        destination: connectingRoute.leg1.destination,
        date: booking.misc.departureDate,
        time: to12Hour(booking.misc.departureTime),
        accommodation,
      },
      {
        origin: connectingRoute.leg2.origin,
        destination: connectingRoute.leg2.destination,
        date: booking.misc.departureDate,
        time: '', // Dynamic: RPA selects based on leg 1 arrival + 20-120 min rule
        accommodation,
      },
    ];

    // For connecting round-trip, resolve the reverse connecting route
    if (isRoundTrip) {
      const reverseRoute = findConnectingRoute(destinationCode, originCode);
      if (!reverseRoute) {
        throw new Error(
          `No reverse connecting route found for ${destinationCode}-${originCode} (booking ${booking.reference})`
        );
      }
      result.connectingReturnLegs = [
        {
          origin: reverseRoute.leg1.origin,
          destination: reverseRoute.leg1.destination,
          date: booking.misc.returnDepartureDate!,
          time: to12Hour(booking.misc.returnDepartureTime!),
          accommodation,
        },
        {
          origin: reverseRoute.leg2.origin,
          destination: reverseRoute.leg2.destination,
          date: booking.misc.returnDepartureDate!,
          time: '', // Dynamic: RPA selects based on leg 1 arrival + 20-120 min rule
          accommodation,
        },
      ];
    }
  }

  return result;
}

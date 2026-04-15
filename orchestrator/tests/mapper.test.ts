import { describe, it, expect } from 'vitest';
import { mapBookingToOceanJet } from '../src/operators/oceanjet/mapper.js';
import type { BookingDetail } from '../src/bookaway/types.js';

/** Extra info definition IDs matching real Bookaway API */
const AGE_DEF = '58f47da902e97f000888b000';
const GENDER_DEF = '58f47db102e97f000888b001';

function makeBooking(overrides: Partial<{
  originCity: string;
  destinationCity: string;
  originStationName: string;
  destinationStationName: string;
  departureDate: string;
  departureTime: string;
  returnDepartureDate: string;
  returnDepartureTime: string;
  lineClass: string;
  passengers: BookingDetail['items'][0]['passengers'];
}>): BookingDetail {
  const {
    originCity = 'Cebu',
    destinationCity = 'Bohol',
    originStationName,
    destinationStationName,
    departureDate = 'Wed, Apr 15th 2026',
    departureTime = '13:00',
    returnDepartureDate,
    returnDepartureTime,
    lineClass = 'Tourist',
    passengers = [
      {
        firstName: 'John',
        lastName: 'Doe',
        _id: 'p1',
        extraInfos: [
          { definition: AGE_DEF, value: '30' },
          { definition: GENDER_DEF, value: 'Male' },
        ],
      },
    ],
  } = overrides;

  return {
    _id: 'booking123',
    reference: 'BW1234567',
    status: 'pending',
    inProgressBy: null,
    contact: { email: 'test@test.com', phone: '+1234567890' },
    misc: {
      route: `${originCity} to ${destinationCity}`,
      departureDate,
      departureTime,
      ...(returnDepartureDate ? { returnDepartureDate } : {}),
      ...(returnDepartureTime ? { returnDepartureTime } : {}),
      passengers: passengers.map((p) => `${p.firstName} ${p.lastName}`).join(', '),
    },
    items: [
      {
        reference: 'IT1234567',
        product: {
          _id: 'prod123',
          lineClass,
        },
        trip: {
          fromId: {
            city: { name: originCity },
            address: '',
            ...(originStationName ? { name: originStationName } : {}),
          },
          toId: {
            city: { name: destinationCity },
            address: '',
            ...(destinationStationName ? { name: destinationStationName } : {}),
          },
        },
        passengers,
      },
    ],
  };
}

describe('mapBookingToOceanJet', () => {
  it('maps a one-way booking', () => {
    const booking = makeBooking({});
    const result = mapBookingToOceanJet(booking);

    expect(result.bookingType).toBe('one-way');
    expect(result.departureLeg.origin).toBe('CEB');
    expect(result.departureLeg.destination).toBe('TAG');
    expect(result.departureLeg.time).toBe('1:00 PM');
    expect(result.departureLeg.accommodation).toBe('TC');
    expect(result.passengers).toHaveLength(1);
    expect(result.passengers[0].firstName).toBe('John');
    expect(result.passengers[0].age).toBe('30');
    expect(result.passengers[0].gender).toBe('Male');
    expect(result.returnLeg).toBeUndefined();
    expect(result.connectingLegs).toBeUndefined();
  });

  it('maps a round-trip booking', () => {
    const booking = makeBooking({
      returnDepartureDate: 'Sun, Apr 19th 2026',
      returnDepartureTime: '08:00',
    });
    const result = mapBookingToOceanJet(booking);

    expect(result.bookingType).toBe('round-trip');
    expect(result.returnLeg).toBeDefined();
    expect(result.returnLeg!.origin).toBe('TAG');
    expect(result.returnLeg!.destination).toBe('CEB');
    expect(result.returnLeg!.time).toBe('8:00 AM');
  });

  it('maps a connecting route (Cebu to Siquijor)', () => {
    const booking = makeBooking({
      originCity: 'Cebu',
      destinationCity: 'Siquijor',
    });
    const result = mapBookingToOceanJet(booking);

    expect(result.bookingType).toBe('connecting-one-way');
    expect(result.connectingLegs).toHaveLength(2);
    expect(result.connectingLegs![0].origin).toBe('CEB');
    expect(result.connectingLegs![0].destination).toBe('TAG');
    expect(result.connectingLegs![0].time).toBe('1:00 PM'); // Uses Bookaway departure time
    expect(result.connectingLegs![1].origin).toBe('TAG');
    expect(result.connectingLegs![1].destination).toBe('SIQ');
    expect(result.connectingLegs![1].time).toBe(''); // Dynamic: RPA selects based on leg 1 arrival
  });

  it('maps a connecting round-trip (Cebu to Siquijor and back)', () => {
    const booking = makeBooking({
      originCity: 'Cebu',
      destinationCity: 'Siquijor',
      returnDepartureDate: 'Sun, Apr 19th 2026',
      returnDepartureTime: '08:20',
    });
    const result = mapBookingToOceanJet(booking);

    expect(result.bookingType).toBe('connecting-round-trip');
    expect(result.connectingLegs).toHaveLength(2);
    expect(result.connectingReturnLegs).toHaveLength(2);
    expect(result.connectingReturnLegs![0].origin).toBe('SIQ');
    expect(result.connectingReturnLegs![0].destination).toBe('TAG');
    expect(result.connectingReturnLegs![1].origin).toBe('TAG');
    expect(result.connectingReturnLegs![1].destination).toBe('CEB');
  });

  it('maps Business accommodation', () => {
    const booking = makeBooking({ lineClass: 'Business' });
    const result = mapBookingToOceanJet(booking);
    expect(result.departureLeg.accommodation).toBe('BC');
  });

  it('resolves Bohol to GET when the port name is Jetafe', () => {
    const booking = makeBooking({
      originCity: 'Cebu',
      destinationCity: 'Bohol',
      destinationStationName: 'Jetafe Port',
    });
    const result = mapBookingToOceanJet(booking);
    expect(result.departureLeg.destination).toBe('GET');
  });

  it('resolves Bohol to TAG when the port name is not Jetafe', () => {
    const booking = makeBooking({
      originCity: 'Cebu',
      destinationCity: 'Bohol',
      destinationStationName: 'Tagbilaran Port',
    });
    const result = mapBookingToOceanJet(booking);
    expect(result.departureLeg.destination).toBe('TAG');
  });

  it('maps real API city names', () => {
    const booking = makeBooking({
      originCity: 'Tagbilaran City, Bohol Island',
      destinationCity: 'Siquijor',
    });
    const result = mapBookingToOceanJet(booking);
    expect(result.departureLeg.origin).toBe('TAG');
    expect(result.departureLeg.destination).toBe('SIQ');
  });

  it('handles multiple passengers', () => {
    const booking = makeBooking({
      passengers: [
        {
          firstName: 'John',
          lastName: 'Doe',
          _id: 'p1',
          extraInfos: [
            { definition: AGE_DEF, value: '30' },
            { definition: GENDER_DEF, value: 'Male' },
          ],
        },
        {
          firstName: 'Jane',
          lastName: 'Doe',
          _id: 'p2',
          extraInfos: [
            { definition: AGE_DEF, value: '28' },
            { definition: GENDER_DEF, value: 'Female' },
          ],
        },
      ],
    });
    const result = mapBookingToOceanJet(booking);
    expect(result.passengers).toHaveLength(2);
    expect(result.passengers[1].firstName).toBe('Jane');
    expect(result.passengers[1].age).toBe('28');
    expect(result.passengers[1].gender).toBe('Female');
  });

  it('throws on unknown origin city', () => {
    const booking = makeBooking({ originCity: 'Manila' });
    expect(() => mapBookingToOceanJet(booking)).toThrow('Unknown origin city');
  });

  it('throws on unknown accommodation class', () => {
    const booking = makeBooking({ lineClass: 'First Class' });
    expect(() => mapBookingToOceanJet(booking)).toThrow(
      'Unknown accommodation class'
    );
  });
});

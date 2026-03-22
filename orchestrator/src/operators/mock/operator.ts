import { logger } from '../../utils/logger.js';
import type { OperatorModule, TranslatedBooking, TicketResult } from '../types.js';

/**
 * Mock operator for end-to-end testing. Returns sequential fake ticket numbers.
 */
export class MockOperator implements OperatorModule {
  private ticketCounter = 0;

  private nextTicket(): string {
    this.ticketCounter++;
    return `MOCK-${String(this.ticketCounter).padStart(4, '0')}`;
  }

  async issueTickets(booking: TranslatedBooking): Promise<TicketResult> {
    logger.info('[MOCK] Issuing tickets', {
      reference: booking.reference,
      bookingType: booking.bookingType,
      passengers: booking.passengers.map((p) => `${p.firstName} ${p.lastName}`),
    });

    const departureTickets: string[] = [];
    const returnTickets: string[] = [];
    const passengerCount = booking.passengers.length;

    switch (booking.bookingType) {
      case 'one-way':
        // 1 ticket per passenger
        for (let i = 0; i < passengerCount; i++) {
          departureTickets.push(this.nextTicket());
        }
        break;

      case 'round-trip':
        // 1 departure + 1 return ticket per passenger
        for (let i = 0; i < passengerCount; i++) {
          departureTickets.push(this.nextTicket());
        }
        for (let i = 0; i < passengerCount; i++) {
          returnTickets.push(this.nextTicket());
        }
        break;

      case 'connecting-one-way':
        // 2 tickets per passenger (leg 1 + leg 2)
        for (let i = 0; i < passengerCount; i++) {
          departureTickets.push(this.nextTicket()); // leg 1
          departureTickets.push(this.nextTicket()); // leg 2
        }
        break;

      case 'connecting-round-trip':
        // 2 departure tickets + 2 return tickets per passenger
        for (let i = 0; i < passengerCount; i++) {
          departureTickets.push(this.nextTicket()); // departure leg 1
          departureTickets.push(this.nextTicket()); // departure leg 2
        }
        for (let i = 0; i < passengerCount; i++) {
          returnTickets.push(this.nextTicket()); // return leg 1
          returnTickets.push(this.nextTicket()); // return leg 2
        }
        break;
    }

    logger.info('[MOCK] Tickets issued', {
      reference: booking.reference,
      departureTickets,
      returnTickets,
    });

    return {
      success: true,
      departureTickets,
      returnTickets,
    };
  }
}

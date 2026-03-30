import axios from 'axios';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { OperatorModule, TranslatedBooking, TicketResult } from '../types.js';

/**
 * OceanJet RPA Operator — sends translated booking data to the Python RPA agent
 * running on a Windows VM. The RPA agent drives PRIME to issue tickets.
 */
export class OceanJetRpaOperator implements OperatorModule {
  private client = axios.create({
    baseURL: config.rpa.agentUrl,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.rpa.authToken}`,
    },
    timeout: 900_000, // 15 minute timeout — connecting multi-pax bookings need several Gemini calls
  });

  async issueTickets(booking: TranslatedBooking): Promise<TicketResult> {
    logger.info('Sending booking to RPA agent', {
      bookingId: booking.bookingId,
      reference: booking.reference,
      bookingType: booking.bookingType,
      passengerCount: booking.passengers.length,
    });

    try {
      const response = await this.client.post<TicketResult>(
        '/issue-tickets',
        booking
      );
      return response.data;
    } catch (error: any) {
      // Distinguish between booking-level failures (RPA reports PRIME rejection)
      // and system-level failures (RPA agent unreachable, PRIME crash)
      if (error.response) {
        // RPA agent responded with an error
        const data = error.response.data;
        logger.error('RPA agent returned error', {
          bookingId: booking.bookingId,
          status: error.response.status,
          data,
        });
        return {
          success: false,
          departureTickets: [],
          returnTickets: [],
          errorCode: data?.errorCode || 'UNKNOWN_ERROR',
          error: data?.error || `RPA agent error: ${error.response.status}`,
          partialResults: data?.partialResults,
        };
      }
      // Network error or timeout — system-level failure
      throw error;
    }
  }
}

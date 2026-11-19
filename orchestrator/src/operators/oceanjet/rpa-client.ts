import axios from 'axios';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { OperatorModule, TranslatedBooking, TicketResult, AgentHealth } from '../types.js';

/**
 * OceanJet RPA Operator — sends translated booking data to one Python RPA
 * agent (one Windows VM, one PRIME session). The RPA agent drives PRIME to
 * issue tickets. The orchestrator creates one instance per agent.
 */
export class OceanJetRpaOperator implements OperatorModule {
  private client;

  constructor(
    readonly url: string,
    readonly name?: string
  ) {
    this.client = axios.create({
      baseURL: url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.rpa.authToken}`,
      },
      timeout: 3_600_000, // 60 minute timeout — large connecting multi-pax bookings need many Gemini calls
    });
  }

  async checkHealth(): Promise<AgentHealth> {
    try {
      const response = await this.client.get<{ status: string; prime_running: boolean }>(
        '/health',
        { timeout: 15_000 }
      );
      return { reachable: true, primeRunning: Boolean(response.data?.prime_running) };
    } catch (error: any) {
      return { reachable: false, primeRunning: false, error: error.message };
    }
  }

  async issueTickets(booking: TranslatedBooking): Promise<TicketResult> {
    logger.info('Sending booking to RPA agent', {
      agent: this.name ?? this.url,
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
          agent: this.name ?? this.url,
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

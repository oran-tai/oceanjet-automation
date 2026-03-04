import type { BookawayClient } from '../bookaway/client.js';
import type { BookingSummary, ApprovalRequest } from '../bookaway/types.js';
import type { OperatorModule } from '../operators/types.js';
import { mapBookingToOceanJet } from '../operators/oceanjet/mapper.js';
import { logger } from '../utils/logger.js';
import {
  notifyBookingFailure,
  notifySystemFailure,
  notifyPartialFailure,
} from '../notifications/slack.js';

export type ProcessResult =
  | { status: 'approved' }
  | { status: 'skipped'; reason: string }
  | { status: 'booking-error'; reason: string }
  | { status: 'system-error'; reason: string };

/**
 * Check if departure date is within PRIME's 1-month booking window.
 */
function isDepartureWithinWindow(departureDateStr: string): boolean {
  // Bookaway format: "Wed, Apr 15th 2026"
  // Strip ordinal suffixes (st, nd, rd, th) and parse
  const cleaned = departureDateStr.replace(/(\d+)(st|nd|rd|th)/g, '$1');
  const departureDate = new Date(cleaned);

  if (isNaN(departureDate.getTime())) {
    // If we can't parse, allow it through rather than blocking
    logger.warn('Could not parse departure date, allowing booking', {
      departureDateStr,
    });
    return true;
  }

  const oneMonthFromNow = new Date();
  oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);

  return departureDate <= oneMonthFromNow;
}

/**
 * Build the Bookaway approval payload from ticket results.
 */
function buildApprovalPayload(
  itemId: string,
  departureTickets: string[],
  returnTickets: string[]
): ApprovalRequest {
  const allTickets = [...departureTickets, ...returnTickets];
  return {
    extras: [],
    pickups: [{ time: 0, location: null }],
    dropOffs: [null],
    voucherAttachments: [],
    approvalInputs: {
      _id: itemId,
      bookingCode: allTickets.join(' '),
      departureTrip: {
        seatsNumber: departureTickets,
        ticketsQrCode: [],
      },
      returnTrip: {
        seatsNumber: returnTickets,
        ticketsQrCode: [],
      },
    },
  };
}

/**
 * Process a single booking end-to-end.
 */
export async function processBooking(
  bookingSummary: BookingSummary,
  operator: OperatorModule,
  client: BookawayClient
): Promise<ProcessResult> {
  const startTime = Date.now();
  const { _id: bookingId, reference } = bookingSummary;

  try {
    // 1. Fetch full details
    const booking = await client.fetchBookingDetails(bookingId);

    // 2. Validate departure window
    if (!isDepartureWithinWindow(booking.misc.departureDate)) {
      logger.info('Booking departure too far out, skipping', {
        reference,
        departureDate: booking.misc.departureDate,
      });
      return { status: 'skipped', reason: 'Departure date beyond 1-month window' };
    }

    // 3. Translate
    const translated = mapBookingToOceanJet(booking);
    logger.info('Booking translated', {
      reference,
      bookingType: translated.bookingType,
      origin: translated.departureLeg.origin,
      destination: translated.departureLeg.destination,
      passengerCount: translated.passengers.length,
    });

    // 4. Issue tickets via operator
    const ticketResult = await operator.issueTickets(translated);

    // 5. Handle result
    if (!ticketResult.success) {
      // Check for partial failure
      if (ticketResult.partialResults?.some((r) => r.success)) {
        // Partial failure — keep claimed, alert
        await notifyPartialFailure(
          reference,
          bookingId,
          ticketResult.partialResults!
        );
        logger.warn('Partial failure, booking remains claimed', {
          reference,
          durationMs: Date.now() - startTime,
        });
        return {
          status: 'booking-error',
          reason: `Partial failure: ${ticketResult.error}`,
        };
      }

      // Full booking-level failure — release and alert
      await client.releaseBooking(bookingId);
      await notifyBookingFailure(
        reference,
        bookingId,
        ticketResult.error || 'Unknown error'
      );
      logger.warn('Booking failed, released', {
        reference,
        error: ticketResult.error,
        durationMs: Date.now() - startTime,
      });
      return {
        status: 'booking-error',
        reason: ticketResult.error || 'Ticket issuance failed',
      };
    }

    // 6. Approve on Bookaway
    const approval = buildApprovalPayload(
      translated.itemId,
      ticketResult.departureTickets,
      ticketResult.returnTickets
    );

    let approveAttempts = 0;
    const maxRetries = 3;
    while (approveAttempts < maxRetries) {
      try {
        await client.approveBooking(bookingId, approval);
        break;
      } catch (error: any) {
        approveAttempts++;
        if (approveAttempts >= maxRetries) {
          // Approval failed after retries — keep claimed, alert
          await notifyBookingFailure(
            reference,
            bookingId,
            `Approval API failed after ${maxRetries} retries: ${error.message}`
          );
          logger.error('Approval failed after retries', {
            reference,
            error: error.message,
            durationMs: Date.now() - startTime,
          });
          return {
            status: 'booking-error',
            reason: `Approval failed: ${error.message}`,
          };
        }
        logger.warn(`Approval attempt ${approveAttempts} failed, retrying...`, {
          reference,
          error: error.message,
        });
      }
    }

    logger.info('Booking processed successfully', {
      reference,
      bookingType: translated.bookingType,
      departureTickets: ticketResult.departureTickets,
      returnTickets: ticketResult.returnTickets,
      durationMs: Date.now() - startTime,
    });

    return { status: 'approved' };
  } catch (error: any) {
    // System-level error (network failure, PRIME crash, etc.)
    // Release booking, alert, signal to stop the loop
    try {
      await client.releaseBooking(bookingId);
    } catch {
      logger.error('Failed to release booking after system error', {
        reference,
      });
    }
    await notifySystemFailure(error.message, reference);
    logger.error('System error during booking processing', {
      reference,
      error: error.message,
      durationMs: Date.now() - startTime,
    });
    return { status: 'system-error', reason: error.message };
  }
}

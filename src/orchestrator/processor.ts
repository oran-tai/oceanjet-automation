import type { BookawayClient } from '../bookaway/client.js';
import type { BookingSummary, ApprovalRequest } from '../bookaway/types.js';
import type { OperatorModule, TicketErrorCode } from '../operators/types.js';
import { SYSTEM_ERROR_CODES, TICKET_ERROR_LABELS } from '../operators/types.js';
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
  | { status: 'booking-error'; reason: string; errorCode?: TicketErrorCode }
  | { status: 'system-error'; reason: string; errorCode?: TicketErrorCode };

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

    // 2. Verify booking is still pending
    if (booking.status !== 'pending') {
      logger.info('Booking no longer pending, skipping', {
        reference,
        status: booking.status,
      });
      return { status: 'skipped', reason: `Booking status is '${booking.status}', not pending` };
    }

    // 3. Validate departure window
    if (!isDepartureWithinWindow(booking.misc.departureDate)) {
      logger.info('Booking departure too far out, skipping', {
        reference,
        departureDate: booking.misc.departureDate,
      });
      return { status: 'skipped', reason: 'Departure date beyond 1-month window' };
    }

    // 4. Translate
    const translated = mapBookingToOceanJet(booking);
    logger.info('Booking translated', {
      reference,
      bookingType: translated.bookingType,
      origin: translated.departureLeg.origin,
      destination: translated.departureLeg.destination,
      passengerCount: translated.passengers.length,
    });

    // 5. Issue tickets via operator
    const ticketResult = await operator.issueTickets(translated);

    // 6. Handle result
    if (!ticketResult.success) {
      const errorCode = ticketResult.errorCode || 'UNKNOWN_ERROR';
      const errorLabel = TICKET_ERROR_LABELS[errorCode];
      const errorDetail = ticketResult.error
        ? `${errorLabel} — ${ticketResult.error}`
        : errorLabel;

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
          errorCode,
          durationMs: Date.now() - startTime,
        });
        return {
          status: 'booking-error',
          reason: `Partial failure: ${errorDetail}`,
          errorCode,
        };
      }

      // System-level RPA error — release, alert, and stop the loop
      if (SYSTEM_ERROR_CODES.has(errorCode)) {
        await client.releaseBooking(bookingId);
        await notifySystemFailure(errorDetail, reference);
        logger.error('System-level RPA error, stopping', {
          reference,
          errorCode,
          durationMs: Date.now() - startTime,
        });
        return {
          status: 'system-error',
          reason: errorDetail,
          errorCode,
        };
      }

      // Booking-level failure — release and alert, continue loop
      await client.releaseBooking(bookingId);
      await notifyBookingFailure(
        reference,
        bookingId,
        errorCode,
        errorDetail
      );
      logger.warn('Booking failed, released', {
        reference,
        errorCode,
        error: ticketResult.error,
        durationMs: Date.now() - startTime,
      });
      return {
        status: 'booking-error',
        reason: errorDetail,
        errorCode,
      };
    }

    // 7. Approve on Bookaway
    const approval = buildApprovalPayload(
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
            'UNKNOWN_ERROR',
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

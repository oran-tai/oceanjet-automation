import type { BookawayClient } from '../bookaway/client.js';
import type { BookingSummary, ApprovalRequest } from '../bookaway/types.js';
import type { OperatorModule, TicketErrorCode, PassengerData } from '../operators/types.js';
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
 * Validate that all passengers have the required fields for PRIME.
 * Returns an array of error messages (empty = all valid).
 */
function validatePassengers(passengers: PassengerData[]): string[] {
  const errors: string[] = [];
  const validGenders = ['Male', 'Female', 'male', 'female', 'M', 'F'];

  for (let i = 0; i < passengers.length; i++) {
    const p = passengers[i];
    const label = `Passenger ${i + 1} (${p.firstName || '?'} ${p.lastName || '?'})`;

    if (!p.firstName || p.firstName.trim() === '') {
      errors.push(`${label}: missing first name`);
    }
    if (!p.lastName || p.lastName.trim() === '') {
      errors.push(`${label}: missing last name`);
    }
    if (!p.age || p.age === 'Unknown' || isNaN(Number(p.age))) {
      errors.push(`${label}: missing or invalid age "${p.age}"`);
    }
    if (!p.gender || p.gender === 'Unknown' || !validGenders.includes(p.gender)) {
      errors.push(`${label}: missing or invalid gender "${p.gender}"`);
    }
  }

  return errors;
}

/**
 * Check if departure date is within N days from now.
 */
function isDepartureWithinDays(departureDateStr: string, days: number): boolean {
  const cleaned = departureDateStr.replace(/(\d+)(st|nd|rd|th)/g, '$1');
  const departureDate = new Date(cleaned);
  if (isNaN(departureDate.getTime())) return true; // Can't parse → alert to be safe
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  return departureDate <= cutoff;
}

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

  const twoMonthsFromNow = new Date();
  twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);

  return departureDate <= twoMonthsFromNow;
}

/**
 * Group a flat ticket array into per-passenger strings.
 * e.g., ["t1", "t2", "t3", "t4"] with 2 passengers → ["t1 t2", "t3 t4"]
 *
 * For one-way / round-trip: 1 ticket per passenger → ["t1", "t2"]
 * For connecting: 2 tickets per passenger (leg1 + leg2) → ["t1 t2", "t3 t4"]
 */
function groupTicketsByPassenger(tickets: string[], passengerCount: number): string[] {
  if (tickets.length === 0) return [];
  const ticketsPerPax = Math.floor(tickets.length / passengerCount);
  if (ticketsPerPax <= 1) return tickets;

  const grouped: string[] = [];
  for (let i = 0; i < tickets.length; i += ticketsPerPax) {
    grouped.push(tickets.slice(i, i + ticketsPerPax).join(' '));
  }
  return grouped;
}

/**
 * Build the Bookaway approval payload from ticket results.
 */
function buildApprovalPayload(
  departureTickets: string[],
  returnTickets: string[],
  passengerCount: number
): ApprovalRequest {
  const allTickets = [...departureTickets, ...returnTickets];
  const depSeats = groupTicketsByPassenger(departureTickets, passengerCount);
  const retSeats = groupTicketsByPassenger(returnTickets, passengerCount);

  return {
    extras: [],
    pickups: [{ time: 0, location: null }],
    dropOffs: [null],
    voucherAttachments: [],
    approvalInputs: {
      bookingCode: allTickets.join(' '),
      departureTrip: {
        seatsNumber: depSeats,
        ticketsQrCode: [],
      },
      returnTrip: {
        seatsNumber: retSeats,
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

    // 5. Validate passenger data before touching PRIME
    const passengerErrors = validatePassengers(translated.passengers);
    if (passengerErrors.length > 0) {
      const errorCode: TicketErrorCode = 'PASSENGER_VALIDATION_ERROR';
      const errorDetail = `${TICKET_ERROR_LABELS[errorCode]} — ${passengerErrors.join('; ')}`;
      await client.releaseBooking(bookingId);
      await notifyBookingFailure(reference, bookingId, errorCode, errorDetail);
      logger.warn('Passenger validation failed, skipping', {
        reference,
        errors: passengerErrors,
        durationMs: Date.now() - startTime,
      });
      return {
        status: 'booking-error',
        reason: errorDetail,
        errorCode,
      };
    }

    // 6. Issue tickets via operator
    const ticketResult = await operator.issueTickets(translated);

    // 7. Handle result
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

      // TRIP_NOT_FOUND only alerts if departure is within 7 days —
      // further out, the operator may not have opened schedules yet
      const shouldAlert =
        errorCode !== 'TRIP_NOT_FOUND' ||
        isDepartureWithinDays(booking.misc.departureDate, 7);

      if (shouldAlert) {
        await notifyBookingFailure(
          reference,
          bookingId,
          errorCode,
          errorDetail
        );
      } else {
        logger.info('TRIP_NOT_FOUND with departure > 7 days out, skipping Slack alert', {
          reference,
          departureDate: booking.misc.departureDate,
        });
      }
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

    // 8. Approve on Bookaway
    const approval = buildApprovalPayload(
      ticketResult.departureTickets,
      ticketResult.returnTickets,
      translated.passengers.length
    );

    logger.info('Approving booking', { bookingId });
    let approveAttempts = 0;
    const maxRetries = 3;
    while (approveAttempts < maxRetries) {
      const attemptStart = Date.now();
      try {
        await client.approveBooking(bookingId, approval);
        logger.info(`Approval succeeded (attempt ${approveAttempts + 1})`, {
          reference,
          durationMs: Date.now() - attemptStart,
        });
        break;
      } catch (error: any) {
        approveAttempts++;
        logger.warn(`Approval attempt ${approveAttempts} failed`, {
          reference,
          error: error.message,
          durationMs: Date.now() - attemptStart,
        });
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

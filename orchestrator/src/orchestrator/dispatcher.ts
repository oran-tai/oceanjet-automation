import type { BookawayClient } from '../bookaway/client.js';
import type { BookingSummary } from '../bookaway/types.js';
import { logger } from '../utils/logger.js';
import { isDepartureWithinWindow } from '../utils/time.js';

/**
 * Decide from the list response alone whether a booking is worth claiming.
 * Returns a skip reason, or null to proceed. Saves a claim + details fetch +
 * release round-trip per cycle for every booking we would skip anyway.
 */
export function preClaimSkipReason(booking: BookingSummary): string | null {
  const departureDate = booking.misc?.departureDate;
  if (departureDate && !isDepartureWithinWindow(departureDate)) {
    return 'Departure date beyond 2-month window';
  }
  return null;
}

/** Hold a booking until the orchestrator restarts (a human must look at it). */
export const HOLD_UNTIL_RESTART = Number.POSITIVE_INFINITY;

export interface DispatchResult {
  booking: BookingSummary | null;
  /** Bookings left out because their departure is beyond PRIME's window. */
  preClaimSkipped: number;
}

/**
 * Hands bookings to RPA agents, one at a time.
 *
 * The orchestrator is the only process that claims OceanJet bookings, and
 * every pick goes through `next()`, which runs strictly one call at a time:
 * fetch a fresh list → choose the earliest-departure booking nobody holds →
 * claim it → mark it in flight. Two agents can therefore never receive the
 * same booking, without relying on Bookaway's claim being atomic.
 */
export class Dispatcher {
  private chain: Promise<unknown> = Promise.resolve();
  private inFlight = new Set<string>();
  /** bookingId → epoch ms before which it is not handed out again. */
  private holds = new Map<string, number>();

  constructor(
    private client: Pick<BookawayClient, 'fetchPendingBookings' | 'claimBooking'>,
    private options: { targetBooking?: string; now?: () => number } = {}
  ) {}

  /** Pick and claim the next booking for an agent; `booking: null` when none is ready. */
  next(): Promise<DispatchResult> {
    const run = this.chain.then(() => this.pick());
    // Keep the chain alive whether this pick succeeds or throws
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Report that an agent is done with a booking. `holdMs` keeps it from being
   * handed out again for that long (HOLD_UNTIL_RESTART for the rest of the run).
   */
  finish(bookingId: string, holdMs: number): void {
    this.inFlight.delete(bookingId);
    if (holdMs > 0) this.holds.set(bookingId, this.now() + holdMs);
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private async pick(): Promise<DispatchResult> {
    const now = this.now();
    for (const [id, until] of this.holds) {
      if (now >= until) this.holds.delete(id);
    }

    const bookings = await this.client.fetchPendingBookings();
    const target = this.options.targetBooking;
    let preClaimSkipped = 0;

    for (const b of bookings) {
      if (target && b.reference !== target) continue;
      if (b.inProgressBy) {
        logger.debug('Skipping claimed booking', { reference: b.reference, claimedBy: b.inProgressBy });
        continue;
      }
      if (this.inFlight.has(b._id)) continue;
      const holdUntil = this.holds.get(b._id);
      if (holdUntil !== undefined && now < holdUntil) {
        logger.debug('Skipping held booking', { reference: b.reference });
        continue;
      }
      const skipReason = preClaimSkipReason(b);
      if (skipReason) {
        preClaimSkipped++;
        logger.debug('Skipping booking before claim', {
          reference: b.reference,
          reason: skipReason,
          departureDate: b.misc?.departureDate,
        });
        continue;
      }

      this.inFlight.add(b._id);
      try {
        await this.client.claimBooking(b._id);
      } catch (error: any) {
        this.inFlight.delete(b._id);
        // Leave it for the next poll rather than hammering a failing claim
        this.holds.set(b._id, now + 60_000);
        logger.error('Failed to claim booking, trying the next one', {
          reference: b.reference,
          error: error.message,
        });
        continue;
      }
      return { booking: b, preClaimSkipped };
    }
    return { booking: null, preClaimSkipped };
  }
}

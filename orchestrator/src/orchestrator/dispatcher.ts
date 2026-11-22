import type { BookawayClient } from '../bookaway/client.js';
import type { BookingSummary } from '../bookaway/types.js';
import { logger } from '../utils/logger.js';
import { isDepartureWithinWindow } from '../utils/time.js';
import {
  MemoryDispatchStore,
  UNTIL_AGENT_RESTART,
  type DispatchStore,
  type RegisterResult,
} from './dispatch-store.js';

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

/** Hold a booking until the agent's worker restarts (a human must look at it). */
export const HOLD_UNTIL_RESTART = UNTIL_AGENT_RESTART;

/** How long a booking stays held when its agent restarted mid-booking. */
export const INTERRUPTED_HOLD_MS = 24 * 3_600_000;

export interface DispatchResult {
  booking: BookingSummary | null;
  /** Bookings left out because their departure is beyond PRIME's window. */
  preClaimSkipped: number;
}

/**
 * What a worker needs from a dispatcher — implemented in-process by
 * `Dispatcher` and over HTTPS by `RemoteDispatcher` (the cloud service).
 */
export interface BookingDispatcher {
  /** Pick and claim the next booking for `agent`; `booking: null` when none is ready. */
  next(agent: string, targetBooking?: string): Promise<DispatchResult>;
  /** The agent is done with a booking; keep it out of the queue for `holdMs` (HOLD_UNTIL_RESTART allowed). */
  finish(bookingId: string, agent: string, holdMs: number): Promise<void>;
  /** The agent's worker is starting. */
  register(agent: string): Promise<RegisterResult>;
}

/**
 * Hands bookings to RPA agents, one at a time.
 *
 * Every pick goes through `next()`, which runs strictly one call at a time
 * within this process: fetch a fresh list → choose the earliest-departure
 * booking nobody holds → reserve it in the store → claim it in Bookaway.
 * The store's reservation is atomic, so two agents never receive the same
 * booking — without relying on Bookaway's claim being atomic.
 */
export class Dispatcher implements BookingDispatcher {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private client: Pick<BookawayClient, 'fetchPendingBookings' | 'claimBooking'>,
    private store: DispatchStore = new MemoryDispatchStore(),
    private options: { now?: () => number } = {}
  ) {}

  next(agent: string, targetBooking?: string): Promise<DispatchResult> {
    const run = this.chain.then(() => this.pick(agent, targetBooking));
    // Keep the chain alive whether this pick succeeds or throws
    this.chain = run.catch(() => undefined);
    return run;
  }

  async finish(bookingId: string, agent: string, holdMs: number): Promise<void> {
    const now = this.now();
    const until = holdMs === HOLD_UNTIL_RESTART ? HOLD_UNTIL_RESTART : now + holdMs;
    await this.store.finish(bookingId, agent, until, now);
  }

  async register(agent: string): Promise<RegisterResult> {
    const now = this.now();
    return this.store.registerAgent(agent, now, now + INTERRUPTED_HOLD_MS);
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private async pick(agent: string, target?: string): Promise<DispatchResult> {
    const now = this.now();
    const [bookings, taken] = await Promise.all([
      this.client.fetchPendingBookings(),
      this.store.active(now),
    ]);
    let preClaimSkipped = 0;

    for (const b of bookings) {
      if (target && b.reference !== target) continue;
      if (b.inProgressBy) {
        logger.debug('Skipping claimed booking', { reference: b.reference, claimedBy: b.inProgressBy });
        continue;
      }
      if (taken.has(b._id)) {
        logger.debug('Skipping booking in flight or held', { reference: b.reference });
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

      // Atomic: if another caller reserved it a moment ago, move on
      if (!(await this.store.reserve(b._id, b.reference, agent, now))) continue;

      try {
        await this.client.claimBooking(b._id);
      } catch (error: any) {
        // Leave it for a later pick rather than hammering a failing claim
        await this.store.finish(b._id, agent, now + 60_000, now).catch(() => undefined);
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

import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import type { BookawayClient } from '../bookaway/client.js';
import type { OperatorModule } from '../operators/types.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { processBooking, type ProcessResult } from './processor.js';
import {
  notifyPollCycleSummary,
  notifySystemFailure,
  notifyDispatcherUnreachable,
  notifyInterruptedBookings,
} from '../notifications/slack.js';
import { trackEvent } from '../events/bigquery.js';
import { Dispatcher, HOLD_UNTIL_RESTART, type BookingDispatcher } from './dispatcher.js';

/** How long a worker may fail to get bookings from a remote dispatcher before alerting. */
const DISPATCHER_ALERT_AFTER_MS = 5 * 60_000;

export { preClaimSkipReason } from './dispatcher.js';

const STOP_FILE = resolve(process.cwd(), '.stop');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True (once) when the `stop` command has dropped a .stop file. */
function consumeStopFile(): boolean {
  if (!existsSync(STOP_FILE)) return false;
  try { unlinkSync(STOP_FILE); } catch { /* ignore */ }
  logger.info('Manual stop requested via .stop file');
  return true;
}

/**
 * How long a finished booking stays out of the queue.
 * - system error: until restart — tickets may exist (e.g. an orphan ticket),
 *   so no other agent may pick it up before a human has looked at it
 * - booking error: the 24h cooldown (no repeat attempt, no repeat alert)
 * - approved / skipped: one poll interval, so a stale list entry is not re-picked
 */
export function holdAfter(result: ProcessResult): number {
  switch (result.status) {
    case 'system-error':
      return HOLD_UNTIL_RESTART;
    case 'booking-error':
      return config.pacing.bookingErrorCooldownMs;
    default:
      return config.polling.intervalMs;
  }
}

/** Drop agents that cannot take bookings, with an alert for each. */
async function readyAgents(operators: OperatorModule[]): Promise<OperatorModule[]> {
  const ready: OperatorModule[] = [];
  for (const op of operators) {
    if (!op.checkHealth) {
      ready.push(op);
      continue;
    }
    const health = await op.checkHealth();
    if (health.reachable && health.primeRunning) {
      logger.info('RPA agent ready', { agent: op.name });
      ready.push(op);
      continue;
    }
    const reason = health.reachable
      ? 'RPA agent is up but cannot find the PRIME window — open PRIME and log in'
      : `RPA agent unreachable at startup (${health.error ?? 'no response'}) — start run-rpa on that VM`;
    logger.error('RPA agent not ready, leaving it out', { agent: op.name, reason });
    await notifySystemFailure(reason, undefined, operators.length > 1 ? op.name : undefined);
  }
  return ready;
}

export async function startOrchestrator(
  client: BookawayClient,
  operators: OperatorModule[],
  remoteDispatcher?: BookingDispatcher
): Promise<void> {
  const state = { running: true };

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutdown signal received, stopping after the current bookings...');
    state.running = false;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await client.login();

  const ready = await readyAgents(operators);
  if (ready.length === 0) {
    throw new Error('No RPA agent is ready — nothing to dispatch to');
  }

  const dispatcher = remoteDispatcher ?? new Dispatcher(client);

  // Tell the dispatcher each agent is (re)starting: bookings it had in flight
  // when it last stopped are held for review, its system-error holds clear
  for (const op of ready) {
    const agent = agentId(op);
    const { interrupted, cleared } = await dispatcher.register(agent);
    if (cleared.length > 0) {
      logger.info('Released bookings held after a system error on this agent', { agent, cleared });
    }
    if (interrupted.length > 0) {
      logger.warn('Agent restarted while bookings were in flight — held for review', { agent, interrupted });
      await notifyInterruptedBookings(agent, interrupted);
    }
  }

  await runAgents(client, ready, { state, dispatcher, remote: Boolean(remoteDispatcher) });
}

/** The name an agent is known by to the dispatcher. */
function agentId(op: OperatorModule): string {
  return op.name ?? 'rpa';
}

export interface RunOptions {
  /** Shared running flag (SIGINT flips it). */
  state?: { running: boolean };
  /** Returns true when a manual stop was requested. Defaults to the .stop file. */
  stopRequested?: () => boolean;
  /** Where bookings come from. Defaults to an in-process Dispatcher. */
  dispatcher?: BookingDispatcher;
  /** True when the dispatcher is the cloud service (alerts if it stays unreachable). */
  remote?: boolean;
}

/**
 * Run one worker per RPA agent. Each worker asks the dispatcher for the next
 * booking, processes it on its own agent, and paces itself. A system error
 * stops that agent only; the orchestrator ends when every worker has ended.
 */
export async function runAgents(
  client: BookawayClient,
  operators: OperatorModule[],
  options: RunOptions = {}
): Promise<void> {
  const state = options.state ?? { running: true };
  const stopRequested = options.stopRequested ?? consumeStopFile;
  const dispatcher = options.dispatcher ?? new Dispatcher(client);
  const targetBooking = config.targetBooking || undefined;
  // Workers of this process currently booking (the summary waits for all to go idle)
  let busy = 0;

  logger.info('Orchestrator started', {
    agents: operators.map((op) => op.name ?? 'rpa'),
    pollingIntervalMs: config.polling.intervalMs,
    operatorMode: config.operatorMode,
    bookingErrorCooldownMs: config.pacing.bookingErrorCooldownMs,
  });

  // Results since the queue last ran dry — reported as one "poll cycle"
  let summary = { approved: [] as string[], skipped: [] as string[], bookingErrors: [] as string[], systemErrors: [] as string[] };

  const flushSummary = async () => {
    const { approved, skipped, bookingErrors, systemErrors } = summary;
    const total = approved.length + skipped.length + bookingErrors.length + systemErrors.length;
    if (total === 0) return;
    summary = { approved: [], skipped: [], bookingErrors: [], systemErrors: [] };

    const parts: string[] = [];
    if (approved.length > 0) parts.push(`Approved (${approved.length}): ${approved.join(', ')}`);
    if (skipped.length > 0) parts.push(`Skipped (${skipped.length}): ${skipped.join(', ')}`);
    if (bookingErrors.length > 0) parts.push(`Errors (${bookingErrors.length}): ${bookingErrors.join(', ')}`);
    if (systemErrors.length > 0) parts.push(`System errors (${systemErrors.length}): ${systemErrors.join(', ')}`);
    logger.info(`Poll cycle summary (${total} processed):\n  ${parts.join('\n  ')}`);
    await notifyPollCycleSummary(approved, skipped, bookingErrors, systemErrors);
    await trackEvent('poll_cycle_completed', {
      approved_count: approved.length,
      skipped_count: skipped.length,
      booking_errors_count: bookingErrors.length,
      system_errors_count: systemErrors.length,
    });
  };

  let agentsStoppedOnSystemError = 0;

  const runAgent = async (operator: OperatorModule) => {
    const agent = agentId(operator);
    let failingSince: number | null = null;
    let alerted = false;

    while (state.running) {
      if (stopRequested()) {
        state.running = false;
        break;
      }

      let booking;
      try {
        const pick = await dispatcher.next(agent, targetBooking);
        if (failingSince !== null) {
          logger.info('Getting bookings again', { agent, downForSec: Math.round((Date.now() - failingSince) / 1000) });
          failingSince = null;
          alerted = false;
        }
        booking = pick.booking;
        if (!booking) {
          const skippedNote = pick.preClaimSkipped > 0
            ? ` (${pick.preClaimSkipped} skipped before claim: departure beyond 2-month window)`
            : '';
          logger.info(`No unclaimed bookings, waiting...${skippedNote}`, { agent });
        }
      } catch (error: any) {
        // Bookaway or the dispatcher service unreachable — wait and retry,
        // never book without the dispatcher (that could double-book)
        logger.error('Error fetching bookings', { agent, error: error.message });
        failingSince ??= Date.now();
        if (options.remote && !alerted && Date.now() - failingSince >= DISPATCHER_ALERT_AFTER_MS) {
          alerted = true;
          await notifyDispatcherUnreachable(agent, error.message);
        }
        await sleep(config.polling.intervalMs);
        continue;
      }

      if (!booking) {
        if (busy === 0) await flushSummary();
        await sleep(config.polling.intervalMs);
        continue;
      }
      busy++;

      // A claimed booking is always processed, even if a stop arrived meanwhile
      logger.info('Booking assigned', { agent, reference: booking.reference });
      await trackEvent('booking_claimed', {
        booking_id: booking._id,
        reference: booking.reference,
      });

      let result: ProcessResult;
      let holdMs: number;
      try {
        result = await processBooking(booking, operator, client);
        holdMs = holdAfter(result);
      } catch (error: any) {
        // processBooking handles its own failures; reaching here means its
        // state is unknown, so keep the booking away from every agent
        logger.error('Unexpected error processing booking, holding it until restart', {
          agent,
          reference: booking.reference,
          error: error.message,
        });
        result = { status: 'booking-error', reason: error.message };
        holdMs = HOLD_UNTIL_RESTART;
      }
      busy--;
      try {
        await dispatcher.finish(booking._id, agent, holdMs);
      } catch (error: any) {
        // The booking stays "in flight" at the dispatcher — nobody else gets it
        logger.error('Could not report the result to the dispatcher; booking stays reserved', {
          agent,
          reference: booking.reference,
          error: error.message,
        });
      }

      switch (result.status) {
        case 'approved': summary.approved.push(booking.reference); break;
        case 'skipped': summary.skipped.push(booking.reference); break;
        case 'booking-error': summary.bookingErrors.push(booking.reference); break;
        case 'system-error': summary.systemErrors.push(booking.reference); break;
      }

      // If targeting a specific booking, stop after processing it
      if (config.targetBooking) {
        logger.info('Target booking processed, stopping', { reference: booking.reference });
        state.running = false;
        break;
      }

      // A system error stops this agent only
      if (result.status === 'system-error') {
        agentsStoppedOnSystemError++;
        logger.error('System error detected, stopping this RPA agent', {
          agent,
          reason: result.reason,
        });
        break;
      }

      // Pace bookings — delay only after successful end-to-end booking
      if (state.running && result.status === 'approved') {
        const { bookingDelayMinMs, bookingDelayMaxMs } = config.pacing;
        const delay = bookingDelayMinMs + Math.random() * (bookingDelayMaxMs - bookingDelayMinMs);
        logger.info(`Pacing delay: ${Math.round(delay / 1000)}s before next booking`, { agent });
        await sleep(delay);
      }
    }
    logger.info('RPA agent worker stopped', { agent });
  };

  await Promise.all(operators.map(runAgent));
  await flushSummary();

  // With one agent, the processor's alert already said "Automation Stopped"
  if (operators.length > 1 && agentsStoppedOnSystemError === operators.length) {
    await notifySystemFailure('Every RPA agent has stopped after a system error — see the alerts above');
  }

  logger.info('Orchestrator stopped');
}

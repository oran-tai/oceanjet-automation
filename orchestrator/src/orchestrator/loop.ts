import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import type { BookawayClient } from '../bookaway/client.js';
import type { OperatorModule } from '../operators/types.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { processBooking } from './processor.js';
import { notifyPollCycleSummary } from '../notifications/slack.js';
import { trackEvent } from '../events/bigquery.js';

const STOP_FILE = resolve(process.cwd(), '.stop');

export async function startOrchestrator(
  client: BookawayClient,
  operator: OperatorModule
): Promise<void> {
  let running = true;

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutdown signal received, stopping after current booking...');
    running = false;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Login
  await client.login();

  // Booking error cooldown — persists across cycles, resets on restart.
  // Prevents retrying the same booking-level errors (TRIP_NOT_FOUND, TRIP_SOLD_OUT, etc.) every cycle.
  const bookingErrorCache = new Map<string, number>();

  logger.info('Orchestrator started', {
    pollingIntervalMs: config.polling.intervalMs,
    operatorMode: config.operatorMode,
    bookingErrorCooldownMs: config.pacing.bookingErrorCooldownMs,
  });

  while (running) {
    // Check for manual stop signal
    if (existsSync(STOP_FILE)) {
      try { unlinkSync(STOP_FILE); } catch { /* ignore */ }
      logger.info('Manual stop requested via .stop file');
      break;
    }

    // Purge expired booking error cooldowns
    const now = Date.now();
    for (const [id, until] of bookingErrorCache) {
      if (now >= until) bookingErrorCache.delete(id);
    }

    // Reset per-cycle state
    const processedBookingIds = new Set<string>();
    const approved: string[] = [];
    const skipped: string[] = [];
    const bookingErrors: string[] = [];
    const systemErrors: string[] = [];

    try {
      // Fetch pending bookings
      const bookings = await client.fetchPendingBookings();

      // Filter: skip already claimed and already processed
      const unclaimed = bookings.filter((b) => {
        // If targeting a specific booking, skip everything else
        if (config.targetBooking && b.reference !== config.targetBooking) {
          return false;
        }
        if (b.inProgressBy) {
          logger.debug('Skipping claimed booking', {
            reference: b.reference,
            claimedBy: b.inProgressBy,
          });
          return false;
        }
        if (processedBookingIds.has(b._id)) {
          logger.debug('Skipping already-processed booking', {
            reference: b.reference,
          });
          return false;
        }
        const cooldownUntil = bookingErrorCache.get(b._id);
        if (cooldownUntil && Date.now() < cooldownUntil) {
          logger.debug('Skipping booking error cooldown', {
            reference: b.reference,
            cooldownRemainingMin: Math.round((cooldownUntil - Date.now()) / 60000),
          });
          return false;
        }
        return true;
      });

      if (unclaimed.length === 0) {
        logger.info('No unclaimed bookings, waiting...');
      } else {
        logger.info(`Found ${unclaimed.length} unclaimed bookings to process`);
      }

      // Process each unclaimed booking
      for (const booking of unclaimed) {
        if (!running) break;

        // Check for manual stop signal between bookings
        if (existsSync(STOP_FILE)) {
          try { unlinkSync(STOP_FILE); } catch { /* ignore */ }
          logger.info('Manual stop requested via .stop file');
          running = false;
          break;
        }

        try {
          // Claim the booking
          await client.claimBooking(booking._id);
          await trackEvent('booking_claimed', {
            booking_id: booking._id,
            reference: booking.reference,
          });

          // Process it
          const result = await processBooking(booking, operator, client);

          // Track as processed (regardless of result)
          processedBookingIds.add(booking._id);

          // Track result for summary
          switch (result.status) {
            case 'approved':
              approved.push(booking.reference);
              break;
            case 'skipped':
              skipped.push(booking.reference);
              break;
            case 'booking-error':
              bookingErrors.push(booking.reference);
              break;
            case 'system-error':
              systemErrors.push(booking.reference);
              break;
          }

          // Add booking-level errors to cooldown cache
          if (result.status === 'booking-error') {
            bookingErrorCache.set(booking._id, Date.now() + config.pacing.bookingErrorCooldownMs);
          }

          // If targeting a specific booking, stop after processing it
          if (config.targetBooking) {
            logger.info('Target booking processed, stopping', { reference: booking.reference });
            running = false;
            break;
          }

          // If system error, stop the loop
          if (result.status === 'system-error') {
            logger.error('System error detected, stopping orchestrator', {
              reason: result.reason,
            });
            running = false;
            break;
          }

          // Pace bookings — delay only after successful end-to-end booking
          if (running && result.status === 'approved') {
            const { bookingDelayMinMs, bookingDelayMaxMs } = config.pacing;
            const delay = bookingDelayMinMs + Math.random() * (bookingDelayMaxMs - bookingDelayMinMs);
            logger.info(`Pacing delay: ${Math.round(delay / 1000)}s before next booking`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } catch (error: any) {
          // Unexpected error in claim or process — log and skip to next booking
          logger.error('Unexpected error processing booking, skipping', {
            reference: booking.reference,
            error: error.message,
          });
          processedBookingIds.add(booking._id);
          bookingErrors.push(booking.reference);
        }
      }

      // Log poll cycle summary if any bookings were processed
      const totalProcessed = approved.length + skipped.length + bookingErrors.length + systemErrors.length;
      if (totalProcessed > 0) {
        const parts: string[] = [];
        if (approved.length > 0) parts.push(`Approved (${approved.length}): ${approved.join(', ')}`);
        if (skipped.length > 0) parts.push(`Skipped (${skipped.length}): ${skipped.join(', ')}`);
        if (bookingErrors.length > 0) parts.push(`Errors (${bookingErrors.length}): ${bookingErrors.join(', ')}`);
        if (systemErrors.length > 0) parts.push(`System errors (${systemErrors.length}): ${systemErrors.join(', ')}`);
        logger.info(`Poll cycle summary (${totalProcessed} processed):\n  ${parts.join('\n  ')}`);
        await notifyPollCycleSummary(approved, skipped, bookingErrors, systemErrors);
        await trackEvent('poll_cycle_completed', {
          approved_count: approved.length,
          skipped_count: skipped.length,
          booking_errors_count: bookingErrors.length,
          system_errors_count: systemErrors.length,
        });
      }

      // Wait before next poll
      if (running) {
        await new Promise((resolve) =>
          setTimeout(resolve, config.polling.intervalMs)
        );
      }
    } catch (error: any) {
      // Error fetching bookings — likely auth or network issue
      logger.error('Error fetching bookings', { error: error.message });
      if (running) {
        await new Promise((resolve) =>
          setTimeout(resolve, config.polling.intervalMs)
        );
      }
    }
  }

  logger.info('Orchestrator stopped');
}

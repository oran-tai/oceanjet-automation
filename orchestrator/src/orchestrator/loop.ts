import type { BookawayClient } from '../bookaway/client.js';
import type { OperatorModule } from '../operators/types.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { processBooking } from './processor.js';
import { notifyPollCycleSummary } from '../notifications/slack.js';

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

  logger.info('Orchestrator started', {
    pollingIntervalMs: config.polling.intervalMs,
    operatorMode: config.operatorMode,
  });

  while (running) {
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

        try {
          // Claim the booking
          await client.claimBooking(booking._id);

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
      }

      // TODO: Remove after first production validation — stop after first poll cycle
      if (!config.targetBooking) {
        logger.info('First poll cycle complete, stopping for validation');
        running = false;
        break;
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

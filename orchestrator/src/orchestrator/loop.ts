import type { BookawayClient } from '../bookaway/client.js';
import type { OperatorModule } from '../operators/types.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { processBooking } from './processor.js';

export async function startOrchestrator(
  client: BookawayClient,
  operator: OperatorModule
): Promise<void> {
  let running = true;
  /** In-memory duplicate detection set for the current session */
  const processedBookingIds = new Set<string>();

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
          // Unexpected error in claim or process — treat as system error
          logger.error('Unexpected error processing booking', {
            reference: booking.reference,
            error: error.message,
          });
          running = false;
          break;
        }
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

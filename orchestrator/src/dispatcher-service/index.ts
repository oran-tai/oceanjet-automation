import { BookawayClient } from '../bookaway/client.js';
import { Dispatcher } from '../orchestrator/dispatcher.js';
import { FirestoreDispatchStore } from '../orchestrator/dispatch-store-firestore.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { createDispatcherServer } from './server.js';

/**
 * Cloud dispatcher service (Cloud Run): the single place that picks and
 * claims OceanJet bookings for every VM. Workers call it over HTTPS.
 *
 * Env: the Bookaway variables from config.ts, plus
 *   DISPATCH_COLLECTION  Firestore collection (default oceanjet_dispatch)
 *   PORT                 set by Cloud Run (default 8080)
 */
async function main() {
  const collection = (process.env.DISPATCH_COLLECTION || 'oceanjet_dispatch').trim();
  const port = parseInt(process.env.PORT || '8080', 10);

  const client = new BookawayClient();
  await client.login();

  const store = new FirestoreDispatchStore(collection);
  const dispatcher = new Dispatcher(client, store);
  const server = createDispatcherServer(dispatcher, store);

  server.listen(port, () => {
    logger.info('OceanJet dispatcher listening', {
      port,
      collection,
      bookawayEnv: config.bookaway.env,
      botIdentifier: config.bookaway.botIdentifier,
    });
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  logger.error('Dispatcher failed to start', { error: error.message });
  process.exit(1);
});

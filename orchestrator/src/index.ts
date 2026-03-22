import { config } from './config.js';
import { BookawayClient } from './bookaway/client.js';
import { MockOperator } from './operators/mock/operator.js';
import { OceanJetRpaOperator } from './operators/oceanjet/rpa-client.js';
import { startOrchestrator } from './orchestrator/loop.js';
import { logger } from './utils/logger.js';
import type { OperatorModule } from './operators/types.js';

async function main() {
  logger.info('OceanJet Automation starting...', {
    operatorMode: config.operatorMode,
  });

  // Create Bookaway client
  const client = new BookawayClient();

  // Create operator based on mode
  let operator: OperatorModule;
  if (config.operatorMode === 'mock') {
    logger.info('Using mock operator (test mode)');
    operator = new MockOperator();
  } else {
    logger.info('Using RPA operator', { rpaUrl: config.rpa.agentUrl });
    operator = new OceanJetRpaOperator();
  }

  // Start the orchestrator loop
  await startOrchestrator(client, operator);
}

main().catch((error) => {
  logger.error('Fatal error', { error: error.message });
  process.exit(1);
});

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

  // One operator per RPA agent. Names appear in alerts only when there are
  // several agents, so a single-agent setup keeps its original alerts.
  const agents = config.rpa.agents;
  const multi = agents.length > 1;
  let operators: OperatorModule[];
  if (config.operatorMode === 'mock') {
    logger.info('Using mock operator (test mode)', { agents: agents.length });
    operators = agents.map((a) => new MockOperator(multi ? a.name : undefined));
  } else {
    logger.info('Using RPA operator', { agents: agents.map((a) => `${a.name} → ${a.url}`) });
    operators = agents.map((a) => new OceanJetRpaOperator(a.url, multi ? a.name : undefined));
  }

  // Start the orchestrator loop
  await startOrchestrator(client, operators);
}

main().catch((error) => {
  logger.error('Fatal error', { error: error.message });
  process.exit(1);
});

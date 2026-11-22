import { config } from './config.js';
import { BookawayClient } from './bookaway/client.js';
import { MockOperator } from './operators/mock/operator.js';
import { OceanJetRpaOperator } from './operators/oceanjet/rpa-client.js';
import { startOrchestrator } from './orchestrator/loop.js';
import { RemoteDispatcher, googleIdTokenProvider } from './orchestrator/remote-dispatcher.js';
import type { BookingDispatcher } from './orchestrator/dispatcher.js';
import { logger } from './utils/logger.js';
import type { OperatorModule } from './operators/types.js';

async function main() {
  logger.info('OceanJet Automation starting...', {
    operatorMode: config.operatorMode,
  });

  // Create Bookaway client
  const client = new BookawayClient();

  // With the cloud dispatcher, this orchestrator is one worker among several
  // VMs: its agents are named (alerts say which VM stopped). Without it,
  // agents are named only when this orchestrator drives several of them.
  const remote = Boolean(config.dispatcher.url);
  const agents = config.rpa.agents;
  const agentName = (i: number): string | undefined => {
    if (remote) {
      return agents.length === 1 ? config.dispatcher.agentName : `${config.dispatcher.agentName}-${agents[i].name}`;
    }
    return agents.length > 1 ? agents[i].name : undefined;
  };

  let operators: OperatorModule[];
  if (config.operatorMode === 'mock') {
    logger.info('Using mock operator (test mode)', { agents: agents.length });
    operators = agents.map((_, i) => new MockOperator(agentName(i)));
  } else {
    logger.info('Using RPA operator', { agents: agents.map((a) => `${a.name} → ${a.url}`) });
    operators = agents.map((a, i) => new OceanJetRpaOperator(a.url, agentName(i)));
  }

  let dispatcher: BookingDispatcher | undefined;
  if (remote) {
    if (!config.dispatcher.keyFile) {
      throw new Error('DISPATCHER_URL is set but no key file (DISPATCHER_KEY_FILE or BQ_KEY_FILE)');
    }
    logger.info('Using the cloud dispatcher', { url: config.dispatcher.url, agent: config.dispatcher.agentName });
    dispatcher = new RemoteDispatcher(
      config.dispatcher.url,
      googleIdTokenProvider(config.dispatcher.url, config.dispatcher.keyFile)
    );
  }

  // Start the orchestrator loop
  await startOrchestrator(client, operators, dispatcher);
}

main().catch((error) => {
  logger.error('Fatal error', { error: error.message });
  process.exit(1);
});

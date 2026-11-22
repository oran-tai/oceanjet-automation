/**
 * Check this machine can reach the cloud dispatcher the way the worker does
 * (ID token from the service-account key). Read-only: calls /health and
 * /status, never /next — no booking is claimed.
 *
 *   npx tsx tests/dispatcher-check.ts [KEY_FILE]
 *
 * Uses DISPATCHER_URL and DISPATCHER_KEY_FILE / BQ_KEY_FILE from .env unless
 * a key file is given.
 */
import 'dotenv/config';
import { googleIdTokenProvider } from '../src/orchestrator/remote-dispatcher.js';

async function main() {
  const url = (process.env.DISPATCHER_URL || '').trim();
  const keyFile = (process.argv[2] || process.env.DISPATCHER_KEY_FILE || process.env.BQ_KEY_FILE || '').trim();
  if (!url || !keyFile) {
    console.error('Set DISPATCHER_URL in .env and give a key file (or BQ_KEY_FILE in .env)');
    process.exit(2);
  }
  console.log(`Dispatcher: ${url}\nKey file:   ${keyFile}`);

  const authorization = await googleIdTokenProvider(url, keyFile)();
  let ok = true;
  for (const path of ['/health', '/status']) {
    const res = await fetch(url.replace(/\/+$/, '') + path, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    const body = await res.text();
    console.log(`${path}  HTTP ${res.status}  ${body}`);
    ok &&= res.ok;
  }
  console.log(ok ? 'DISPATCHER REACHABLE' : 'DISPATCHER NOT REACHABLE');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});

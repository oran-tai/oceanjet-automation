/**
 * Live check of FirestoreDispatchStore against real Firestore (travelier-ai).
 * Uses a throwaway collection and deletes it at the end. Not part of `npm test`.
 *
 *   npx tsx tests/firestore-store-check.ts
 */
import { Firestore } from '@google-cloud/firestore';
import { FirestoreDispatchStore } from '../src/orchestrator/dispatch-store-firestore.js';
import { UNTIL_AGENT_RESTART } from '../src/orchestrator/dispatch-store.js';

const COLLECTION = `oceanjet_dispatch_test_${Date.now()}`;
const db = new Firestore({ projectId: 'travelier-ai', ignoreUndefinedProperties: true });
const store = new FirestoreDispatchStore(COLLECTION, db);

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function main() {
  const now = Date.now();

  // 1. 20 simultaneous reservations of one booking → exactly one wins
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => store.reserve('b1', 'BW-1', `agent${i % 2}`, now))
  );
  check('20 simultaneous reserves of one booking: exactly 1 wins', results.filter(Boolean).length === 1, results);

  // 2. in flight → active and blocks
  let active = await store.active(now);
  check('reserved booking is active (in flight)', active.get('b1')?.state === 'in_flight', active.get('b1'));
  check('second reserve while in flight is refused', !(await store.reserve('b1', 'BW-1', 'x', now)));

  // 3. timed hold expires
  await store.finish('b1', 'agent0', now + 1_000, now);
  check('timed hold blocks before expiry', !(await store.reserve('b1', 'BW-1', 'x', now + 999)));
  check('timed hold lets go at expiry', await store.reserve('b1', 'BW-1', 'agent1', now + 1_000));

  // 4. finish with no hold frees immediately
  await store.finish('b1', 'agent1', now, now);
  check('finish without hold deletes the entry', !(await store.active(now)).has('b1'));

  // 5. system-error hold until the agent restarts
  await store.reserve('b2', 'BW-2', 'VM1', now);
  await store.finish('b2', 'VM1', UNTIL_AGENT_RESTART, now);
  active = await store.active(now + 10 * 365 * 86_400_000);
  check('system-error hold survives years', active.get('b2')?.until === UNTIL_AGENT_RESTART, active.get('b2'));
  check('other agent registering does not clear it', (await store.registerAgent('VM2', now, now + 1)).cleared.length === 0);

  // 6. interrupted booking on register
  await store.reserve('b3', 'BW-3', 'VM1', now);
  const reg = await store.registerAgent('VM1', now, now + 86_400_000);
  check('register: in-flight booking reported as interrupted', JSON.stringify(reg.interrupted) === '["BW-3"]', reg);
  check('register: system-error hold cleared', JSON.stringify(reg.cleared) === '["BW-2"]', reg);
  active = await store.active(now);
  check('interrupted booking is now held for 24h', active.get('b3')?.state === 'held' && active.get('b3')!.until === now + 86_400_000, active.get('b3'));
  check('cleared booking is free', !active.has('b2'));
}

main()
  .catch((e) => {
    console.error('ERROR', e);
    failures++;
  })
  .finally(async () => {
    const snap = await db.collection(COLLECTION).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
    console.log(`Cleaned up ${snap.size} test document(s) in ${COLLECTION}`);
    console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });

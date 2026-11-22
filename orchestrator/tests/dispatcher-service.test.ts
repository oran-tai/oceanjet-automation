import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { BookingSummary } from '../src/bookaway/types.js';
import { Dispatcher, HOLD_UNTIL_RESTART } from '../src/orchestrator/dispatcher.js';
import { MemoryDispatchStore } from '../src/orchestrator/dispatch-store.js';
import { RemoteDispatcher } from '../src/orchestrator/remote-dispatcher.js';
import { createDispatcherServer } from '../src/dispatcher-service/server.js';

/** Worker ↔ service round trip over real HTTP, with a fake Bookaway behind the service. */
function booking(id: string): BookingSummary {
  return { _id: id, reference: `BW-${id}`, status: 'pending', inProgressBy: null, items: [] };
}

const client = {
  fetchPendingBookings: vi.fn(async () => [booking('a'), booking('b')]),
  claimBooking: vi.fn(async () => undefined),
};
const store = new MemoryDispatchStore();
let server: Server;
let base: string;

beforeAll(async () => {
  server = createDispatcherServer(new Dispatcher(client, store), store);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('dispatcher service over HTTP', () => {
  it('hands two workers different bookings, then nothing', async () => {
    const vm1 = new RemoteDispatcher(base, async () => null);
    const vm2 = new RemoteDispatcher(base, async () => null);

    const [p1, p2] = await Promise.all([vm1.next('VM1'), vm2.next('VM2')]);
    expect([p1.booking?._id, p2.booking?._id].sort()).toEqual(['a', 'b']);
    expect((await vm1.next('VM1')).booking).toBeNull();
  });

  it('carries "hold until restart" across the wire and clears it on register', async () => {
    const vm1 = new RemoteDispatcher(base, async () => null);
    await vm1.finish('a', 'VM1', HOLD_UNTIL_RESTART);
    await vm1.finish('b', 'VM2', 0);

    const status = await fetch(`${base}/status`).then((r) => r.json());
    expect(status.bookings).toEqual([
      expect.objectContaining({ bookingId: 'a', state: 'held', until: 'until agent restarts' }),
    ]);

    expect((await vm1.next('VM2')).booking?._id).toBe('b');
    expect(await vm1.register('VM1')).toEqual({ interrupted: [], cleared: ['BW-a'] });
  });

  it('sends the token provider value as the Authorization header', async () => {
    const seen: (string | undefined)[] = [];
    const spy = createDispatcherServer(new Dispatcher(client, new MemoryDispatchStore()), new MemoryDispatchStore());
    spy.prependListener('request', (req) => seen.push(req.headers.authorization));
    await new Promise<void>((r) => spy.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(spy.address() as AddressInfo).port}`;

    await new RemoteDispatcher(url, async () => 'Bearer test-token').register('VM1');
    await new Promise<void>((r) => spy.close(() => r()));

    expect(seen).toEqual(['Bearer test-token']);
  });

  it('rejects malformed requests with 400', async () => {
    const res = await fetch(`${base}/finish`, { method: 'POST', body: JSON.stringify({ bookingId: 'a', agent: 'VM1', holdMs: -5 }) });
    expect(res.status).toBe(400);
    const res2 = await fetch(`${base}/next`, { method: 'POST', body: '{}' });
    expect(res2.status).toBe(400);
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { BookingSummary } from '../src/bookaway/types.js';
import { Dispatcher, HOLD_UNTIL_RESTART, INTERRUPTED_HOLD_MS } from '../src/orchestrator/dispatcher.js';
import { MemoryDispatchStore } from '../src/orchestrator/dispatch-store.js';

function booking(id: string, extra: Partial<BookingSummary> = {}): BookingSummary {
  return { _id: id, reference: `BW-${id}`, status: 'pending', inProgressBy: null, items: [], ...extra };
}

const tick = () => new Promise((r) => setTimeout(r, 1));

/**
 * Fake Bookaway whose list never reflects claims — the worst case, where
 * only the dispatcher's own bookkeeping keeps two agents apart.
 */
function laggingClient(bookings: BookingSummary[]) {
  return {
    fetchPendingBookings: vi.fn(async () => {
      await tick();
      return bookings.map((b) => ({ ...b }));
    }),
    claimBooking: vi.fn(async (_id: string) => {
      await tick();
    }),
  };
}

describe('Dispatcher', () => {
  it('never hands the same booking to two agents asking at the same moment', async () => {
    const client = laggingClient([booking('a'), booking('b'), booking('c')]);
    const d = new Dispatcher(client);

    const picks = await Promise.all([d.next('VM1'), d.next('VM2'), d.next('VM3')]);

    expect(picks.map((p) => p.booking?._id)).toEqual(['a', 'b', 'c']);
    expect(client.claimBooking).toHaveBeenCalledTimes(3);
  });

  it('never hands out the same booking from two dispatchers sharing one store (two service instances)', async () => {
    const store = new MemoryDispatchStore();
    const list = [booking('a'), booking('b')];
    const d1 = new Dispatcher(laggingClient(list), store);
    const d2 = new Dispatcher(laggingClient(list), store);

    const picks = await Promise.all([d1.next('VM1'), d2.next('VM2')]);

    expect(picks.map((p) => p.booking?._id).sort()).toEqual(['a', 'b']);
  });

  it('runs picks one at a time: each fetch starts after the previous claim', async () => {
    const order: string[] = [];
    const client = {
      fetchPendingBookings: vi.fn(async () => {
        order.push('fetch');
        await tick();
        return [booking('a'), booking('b')];
      }),
      claimBooking: vi.fn(async (id: string) => {
        order.push(`claim ${id}`);
        await tick();
      }),
    };
    const d = new Dispatcher(client);

    await Promise.all([d.next('VM1'), d.next('VM2')]);

    expect(order).toEqual(['fetch', 'claim a', 'fetch', 'claim b']);
  });

  it('returns null when every booking is taken', async () => {
    const d = new Dispatcher(laggingClient([booking('a')]));
    expect((await d.next('VM1')).booking?._id).toBe('a');
    expect((await d.next('VM2')).booking).toBeNull();
  });

  it('skips bookings someone else has claimed in Bookaway', async () => {
    const d = new Dispatcher(laggingClient([booking('a', { inProgressBy: 'agent@bookaway.com' }), booking('b')]));
    expect((await d.next('VM1')).booking?._id).toBe('b');
  });

  it('holds a finished booking for the given time, then offers it again', async () => {
    let now = 1_000;
    const d = new Dispatcher(laggingClient([booking('a')]), new MemoryDispatchStore(), { now: () => now });

    await d.next('VM1');
    await d.finish('a', 'VM1', 500);

    now = 1_499;
    expect((await d.next('VM1')).booking).toBeNull();
    now = 1_500;
    expect((await d.next('VM1')).booking?._id).toBe('a');
  });

  it('offers a finished booking at once when no hold is given', async () => {
    const d = new Dispatcher(laggingClient([booking('a')]));
    await d.next('VM1');
    await d.finish('a', 'VM1', 0);
    expect((await d.next('VM2')).booking?._id).toBe('a');
  });

  it('holds a system-error booking until that agent restarts — not for the other agent', async () => {
    let now = 1_000;
    const d = new Dispatcher(laggingClient([booking('a')]), new MemoryDispatchStore(), { now: () => now });

    await d.next('VM1');
    await d.finish('a', 'VM1', HOLD_UNTIL_RESTART);
    now += 365 * 24 * 3_600_000;
    expect((await d.next('VM2')).booking).toBeNull();

    // Another agent restarting changes nothing
    expect(await d.register('VM2')).toEqual({ interrupted: [], cleared: [] });
    expect((await d.next('VM2')).booking).toBeNull();

    // A human restarted VM1 after looking → the hold clears
    expect(await d.register('VM1')).toEqual({ interrupted: [], cleared: ['BW-a'] });
    expect((await d.next('VM2')).booking?._id).toBe('a');
  });

  it('holds bookings an agent had in flight when it restarts, for 24h', async () => {
    let now = 1_000;
    const d = new Dispatcher(laggingClient([booking('a')]), new MemoryDispatchStore(), { now: () => now });

    await d.next('VM1'); // VM1 crashes mid-booking — no finish
    expect(await d.register('VM1')).toEqual({ interrupted: ['BW-a'], cleared: [] });

    now += INTERRUPTED_HOLD_MS - 1;
    expect((await d.next('VM2')).booking).toBeNull();
    now += 1;
    expect((await d.next('VM2')).booking?._id).toBe('a');
  });

  it('only offers the target booking when one is set', async () => {
    const d = new Dispatcher(laggingClient([booking('a'), booking('b')]));
    expect((await d.next('VM1', 'BW-b')).booking?._id).toBe('b');
    expect((await d.next('VM1', 'BW-b')).booking).toBeNull();
  });

  it('moves on to the next booking when a claim fails, and holds the failed one briefly', async () => {
    let now = 1_000;
    const client = laggingClient([booking('a'), booking('b')]);
    client.claimBooking.mockRejectedValueOnce(new Error('502 Bad Gateway'));
    const d = new Dispatcher(client, new MemoryDispatchStore(), { now: () => now });

    expect((await d.next('VM1')).booking?._id).toBe('b');
    expect((await d.next('VM2')).booking).toBeNull();
    now += 60_000;
    expect((await d.next('VM2')).booking?._id).toBe('a');
  });

  it('skips bookings departing beyond the 2-month window without claiming them', async () => {
    const far = new Date();
    far.setDate(far.getDate() + 90);
    const farDate = far.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const client = laggingClient([booking('a', { misc: { departureDate: farDate } } as Partial<BookingSummary>)]);
    const d = new Dispatcher(client);

    const pick = await d.next('VM1');
    expect(pick.booking).toBeNull();
    expect(pick.preClaimSkipped).toBe(1);
    expect(client.claimBooking).not.toHaveBeenCalled();
  });

  it('keeps working after a fetch fails', async () => {
    const client = laggingClient([booking('a')]);
    client.fetchPendingBookings.mockRejectedValueOnce(new Error('network down'));
    const d = new Dispatcher(client);

    await expect(d.next('VM1')).rejects.toThrow('network down');
    expect((await d.next('VM1')).booking?._id).toBe('a');
  });

  describe('paging past a page of held bookings', () => {
    /** Fake Bookaway list that honours `offset` like the real one (pages of 50). */
    function pagedClient(all: BookingSummary[]) {
      return {
        fetchPendingBookings: vi.fn(async (offset = 0) => all.slice(offset, offset + 50).map((b) => ({ ...b }))),
        claimBooking: vi.fn(async (_id: string) => {}),
      };
    }
    const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => booking(`${prefix}${i}`));
    const farDate = () => {
      const far = new Date();
      far.setDate(far.getDate() + 90);
      return far.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    };

    it('takes the first free booking on a later page when the first page is all held (Nov 22, 2026)', async () => {
      const store = new MemoryDispatchStore();
      const held = ids(50, 'held');
      for (const b of held) {
        await store.reserve(b._id, b.reference, 'VM1', 0);
        await store.finish(b._id, 'VM1', Date.now() + 86_400_000, 0);
      }
      const client = pagedClient([...held, ...ids(30, 'free')]);
      const d = new Dispatcher(client, store);

      expect((await d.next('VM2')).booking?._id).toBe('free0');
      expect(client.fetchPendingBookings.mock.calls.map((c) => c[0])).toEqual([0, 50]);
    });

    it('treats bookings claimed by someone else like held ones and pages on', async () => {
      const claimed = ids(50, 'c').map((b) => ({ ...b, inProgressBy: 'someone@bookaway.com' }));
      const client = pagedClient([...claimed, booking('free')]);

      expect((await new Dispatcher(client).next('VM1')).booking?._id).toBe('free');
    });

    it('fetches one page only when it has a free booking', async () => {
      const client = pagedClient(ids(120, 'b'));
      await new Dispatcher(client).next('VM1');
      expect(client.fetchPendingBookings).toHaveBeenCalledTimes(1);
    });

    it('stops paging at the first booking beyond the 2-month window (the list is sorted by departure)', async () => {
      const claimed = ids(50, 'c').map((b) => ({ ...b, inProgressBy: 'x' }));
      const far = ids(50, 'far').map((b) => ({ ...b, misc: { departureDate: farDate() } } as BookingSummary));
      const client = pagedClient([...claimed, ...far, ...ids(50, 'never')]);

      const pick = await new Dispatcher(client).next('VM1');
      expect(pick.booking).toBeNull();
      expect(pick.preClaimSkipped).toBe(50);
      expect(client.fetchPendingBookings).toHaveBeenCalledTimes(2);
    });

    it('gives up after MAX_PAGES pages', async () => {
      const claimed = ids(50 * 25, 'c').map((b) => ({ ...b, inProgressBy: 'x' }));
      const client = pagedClient(claimed);

      expect((await new Dispatcher(client).next('VM1')).booking).toBeNull();
      expect(client.fetchPendingBookings).toHaveBeenCalledTimes(20);
    });
  });
});

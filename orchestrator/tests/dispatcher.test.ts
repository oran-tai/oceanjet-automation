import { describe, it, expect, vi } from 'vitest';
import type { BookingSummary } from '../src/bookaway/types.js';
import { Dispatcher, HOLD_UNTIL_RESTART } from '../src/orchestrator/dispatcher.js';

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

    const picks = await Promise.all([d.next(), d.next(), d.next()]);

    expect(picks.map((p) => p.booking?._id)).toEqual(['a', 'b', 'c']);
    expect(client.claimBooking).toHaveBeenCalledTimes(3);
    expect(d.inFlightCount).toBe(3);
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

    await Promise.all([d.next(), d.next()]);

    expect(order).toEqual(['fetch', 'claim a', 'fetch', 'claim b']);
  });

  it('returns null when every booking is taken', async () => {
    const d = new Dispatcher(laggingClient([booking('a')]));
    expect((await d.next()).booking?._id).toBe('a');
    expect((await d.next()).booking).toBeNull();
  });

  it('skips bookings someone else has claimed in Bookaway', async () => {
    const d = new Dispatcher(laggingClient([booking('a', { inProgressBy: 'agent@bookaway.com' }), booking('b')]));
    expect((await d.next()).booking?._id).toBe('b');
  });

  it('holds a finished booking for the given time, then offers it again', async () => {
    let now = 1_000;
    const d = new Dispatcher(laggingClient([booking('a')]), { now: () => now });

    await d.next();
    d.finish('a', 500);
    expect(d.inFlightCount).toBe(0);

    now = 1_499;
    expect((await d.next()).booking).toBeNull();
    now = 1_500;
    expect((await d.next()).booking?._id).toBe('a');
  });

  it('holds a system-error booking until restart', async () => {
    let now = 1_000;
    const d = new Dispatcher(laggingClient([booking('a')]), { now: () => now });

    await d.next();
    d.finish('a', HOLD_UNTIL_RESTART);
    now += 365 * 24 * 3_600_000;

    expect((await d.next()).booking).toBeNull();
  });

  it('offers a finished booking at once when no hold is given', async () => {
    const d = new Dispatcher(laggingClient([booking('a')]));
    await d.next();
    d.finish('a', 0);
    expect((await d.next()).booking?._id).toBe('a');
  });

  it('only offers the target booking when one is set', async () => {
    const d = new Dispatcher(laggingClient([booking('a'), booking('b')]), { targetBooking: 'BW-b' });
    expect((await d.next()).booking?._id).toBe('b');
    expect((await d.next()).booking).toBeNull();
  });

  it('moves on to the next booking when a claim fails', async () => {
    const client = laggingClient([booking('a'), booking('b')]);
    client.claimBooking.mockRejectedValueOnce(new Error('502 Bad Gateway'));
    const d = new Dispatcher(client);

    expect((await d.next()).booking?._id).toBe('b');
    expect(d.inFlightCount).toBe(1);
  });

  it('skips bookings departing beyond the 2-month window without claiming them', async () => {
    const far = new Date();
    far.setDate(far.getDate() + 90);
    const farDate = far.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const client = laggingClient([booking('a', { misc: { departureDate: farDate } } as Partial<BookingSummary>)]);
    const d = new Dispatcher(client);

    const pick = await d.next();
    expect(pick.booking).toBeNull();
    expect(pick.preClaimSkipped).toBe(1);
    expect(client.claimBooking).not.toHaveBeenCalled();
  });

  it('keeps working after a fetch fails', async () => {
    const client = laggingClient([booking('a')]);
    client.fetchPendingBookings.mockRejectedValueOnce(new Error('network down'));
    const d = new Dispatcher(client);

    await expect(d.next()).rejects.toThrow('network down');
    expect((await d.next()).booking?._id).toBe('a');
  });
});

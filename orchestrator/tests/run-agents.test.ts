import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BookingSummary } from '../src/bookaway/types.js';
import type { BookawayClient } from '../src/bookaway/client.js';
import type { OperatorModule } from '../src/operators/types.js';
import type { ProcessResult } from '../src/orchestrator/processor.js';

vi.mock('../src/config.js', () => ({
  config: {
    polling: { intervalMs: 1 },
    operatorMode: 'mock',
    pacing: { bookingErrorCooldownMs: 60_000, bookingDelayMinMs: 0, bookingDelayMaxMs: 0 },
    targetBooking: '',
  },
}));
vi.mock('../src/notifications/slack.js', () => ({
  notifySystemFailure: vi.fn(),
  notifyPollCycleSummary: vi.fn(),
}));
vi.mock('../src/events/bigquery.js', () => ({ trackEvent: vi.fn() }));
vi.mock('../src/orchestrator/processor.js', () => ({ processBooking: vi.fn() }));

const { runAgents } = await import('../src/orchestrator/loop.js');
const { processBooking } = await import('../src/orchestrator/processor.js');
const { notifySystemFailure } = await import('../src/notifications/slack.js');

const tick = () => new Promise((r) => setTimeout(r, 1));

/** Fake Bookaway: approved bookings leave the list; claims never show (worst case). */
function fakeBookaway(refs: string[]) {
  const bookings: BookingSummary[] = refs.map((ref) => ({
    _id: `id-${ref}`, reference: ref, status: 'pending', inProgressBy: null, items: [],
  }));
  const client = {
    fetchPendingBookings: vi.fn(async () => {
      await tick();
      return bookings.filter((b) => b.status === 'pending').map((b) => ({ ...b }));
    }),
    claimBooking: vi.fn(async () => { await tick(); }),
  } as unknown as BookawayClient;
  return { client, bookings };
}

function agent(name: string): OperatorModule {
  return { name, issueTickets: vi.fn() };
}

/** processBooking stand-in: records who booked what; `fail` decides system errors. */
function recordProcessing(
  bookings: BookingSummary[],
  fail: (agentName: string, ref: string) => boolean = () => false
) {
  const handled: { agent: string; ref: string }[] = [];
  vi.mocked(processBooking).mockImplementation(async (b, op) => {
    handled.push({ agent: op.name!, ref: b.reference });
    await tick();
    if (fail(op.name!, b.reference)) {
      return { status: 'system-error', reason: 'PRIME crashed' } as ProcessResult;
    }
    bookings.find((x) => x._id === b._id)!.status = 'approved';
    return { status: 'approved' } as ProcessResult;
  });
  return handled;
}

beforeEach(() => {
  vi.mocked(processBooking).mockReset();
  vi.mocked(notifySystemFailure).mockReset();
});

describe('runAgents', () => {
  it('books every booking exactly once, spread across both agents', async () => {
    const refs = ['BW1', 'BW2', 'BW3', 'BW4', 'BW5', 'BW6'];
    const { client, bookings } = fakeBookaway(refs);
    const handled = recordProcessing(bookings);

    await runAgents(client, [agent('VM1'), agent('VM2')], {
      stopRequested: () => handled.length === refs.length,
    });

    expect(handled.map((h) => h.ref).sort()).toEqual(refs);
    expect(new Set(handled.map((h) => h.agent))).toEqual(new Set(['VM1', 'VM2']));
  });

  it('stops only the failing agent; the other books the rest and never touches the failed booking', async () => {
    const { client, bookings } = fakeBookaway(['BW1', 'BW2', 'BW3', 'BW4']);
    const handled = recordProcessing(bookings, (a, ref) => a === 'VM1' && ref === 'BW1');

    await runAgents(client, [agent('VM1'), agent('VM2')], {
      stopRequested: () => ['BW2', 'BW3', 'BW4'].every((r) => handled.some((h) => h.ref === r)),
    });

    // BW1 went to VM1 (first in line), failed, and was never offered again
    expect(handled.filter((h) => h.ref === 'BW1')).toEqual([{ agent: 'VM1', ref: 'BW1' }]);
    // VM1 took nothing after its system error
    expect(handled.filter((h) => h.agent === 'VM1')).toEqual([{ agent: 'VM1', ref: 'BW1' }]);
    expect(handled.filter((h) => h.agent === 'VM2').map((h) => h.ref).sort()).toEqual(['BW2', 'BW3', 'BW4']);
    // One agent still running → no "every agent stopped" alert from the loop
    expect(notifySystemFailure).not.toHaveBeenCalled();
  });

  it('ends with an "every agent stopped" alert when all agents hit system errors', async () => {
    const { client, bookings } = fakeBookaway(['BW1', 'BW2', 'BW3']);
    recordProcessing(bookings, () => true);

    await runAgents(client, [agent('VM1'), agent('VM2')], { stopRequested: () => false });

    expect(processBooking).toHaveBeenCalledTimes(2);
    expect(notifySystemFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifySystemFailure).mock.calls[0][0]).toMatch(/Every RPA agent has stopped/);
  });

  it('with one agent, a system error ends the run without an extra alert (processor already sent it)', async () => {
    const { client, bookings } = fakeBookaway(['BW1', 'BW2']);
    recordProcessing(bookings, () => true);

    await runAgents(client, [agent('VM1')], { stopRequested: () => false });

    expect(processBooking).toHaveBeenCalledTimes(1);
    expect(notifySystemFailure).not.toHaveBeenCalled();
  });

  it('a stop request lets in-flight bookings finish and starts no new ones', async () => {
    const { client, bookings } = fakeBookaway(['BW1', 'BW2', 'BW3', 'BW4']);
    const handled = recordProcessing(bookings);
    let checks = 0;

    // Each agent checks once before its first pick; stop on the next check
    await runAgents(client, [agent('VM1'), agent('VM2')], { stopRequested: () => ++checks > 2 });

    expect(handled.map((h) => h.ref).sort()).toEqual(['BW1', 'BW2']);
  });
});

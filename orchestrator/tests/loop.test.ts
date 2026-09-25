import { describe, it, expect, vi } from 'vitest';
import type { BookingSummary } from '../src/bookaway/types.js';

vi.mock('../src/config.js', () => ({
  config: {
    polling: { intervalMs: 1 },
    operatorMode: 'mock',
    pacing: { bookingErrorCooldownMs: 1, bookingDelayMinMs: 0, bookingDelayMaxMs: 0 },
    targetBooking: '',
  },
}));

const { preClaimSkipReason } = await import('../src/orchestrator/loop.js');

function summary(departureDate?: string): BookingSummary {
  return {
    _id: 'id1',
    reference: 'BW5516606',
    status: 'pending',
    inProgressBy: null,
    items: [],
    ...(departureDate ? { misc: { departureDate } } : {}),
  };
}

function bookawayDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

describe('preClaimSkipReason', () => {
  it('skips a booking whose list-level departure is beyond the window', () => {
    expect(preClaimSkipReason(summary(bookawayDate(90)))).toBe('Departure date beyond 2-month window');
  });
  it('lets a near-term booking through', () => {
    expect(preClaimSkipReason(summary(bookawayDate(5)))).toBeNull();
  });
  it('lets a summary without a departure date through to the details check', () => {
    expect(preClaimSkipReason(summary())).toBeNull();
  });
});

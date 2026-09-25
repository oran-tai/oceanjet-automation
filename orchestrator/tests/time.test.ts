import { describe, it, expect } from 'vitest';
import { to12Hour } from '../src/utils/time.js';

describe('to12Hour', () => {
  it('converts afternoon time', () => {
    expect(to12Hour('13:00')).toBe('1:00 PM');
  });

  it('converts morning time', () => {
    expect(to12Hour('08:20')).toBe('8:20 AM');
  });

  it('converts noon', () => {
    expect(to12Hour('12:00')).toBe('12:00 PM');
  });

  it('converts midnight', () => {
    expect(to12Hour('00:00')).toBe('12:00 AM');
  });

  it('converts late evening', () => {
    expect(to12Hour('23:45')).toBe('11:45 PM');
  });

  it('converts early morning', () => {
    expect(to12Hour('07:00')).toBe('7:00 AM');
  });

  it('converts 15:20', () => {
    expect(to12Hour('15:20')).toBe('3:20 PM');
  });

  it('converts 10:30', () => {
    expect(to12Hour('10:30')).toBe('10:30 AM');
  });

  it('converts 15:30', () => {
    expect(to12Hour('15:30')).toBe('3:30 PM');
  });
});

import { isDepartureWithinWindow, parseBookawayDate } from '../src/utils/time.js';

describe('parseBookawayDate', () => {
  it('strips ordinal suffixes', () => {
    const d = parseBookawayDate('Wed, Nov 25th 2026');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(10);
    expect(d?.getDate()).toBe(25);
  });
  it('returns null for garbage', () => {
    expect(parseBookawayDate('not a date')).toBeNull();
  });
});

describe('isDepartureWithinWindow', () => {
  const now = new Date('2026-09-24T20:15:00Z');
  it('allows a departure inside two months', () => {
    expect(isDepartureWithinWindow('Fri, Oct 2nd 2026', now)).toBe(true);
  });
  it('allows a departure on the cutoff day', () => {
    expect(isDepartureWithinWindow('Tue, Nov 24th 2026', now)).toBe(true);
  });
  it('rejects a departure beyond two months', () => {
    expect(isDepartureWithinWindow('Wed, Nov 25th 2026', now)).toBe(false);
  });
  it('allows unparseable dates through', () => {
    expect(isDepartureWithinWindow('???', now)).toBe(true);
  });
});

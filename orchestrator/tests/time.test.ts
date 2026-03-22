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

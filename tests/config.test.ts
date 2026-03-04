import { describe, it, expect } from 'vitest';
import {
  resolveStationCode,
  resolveAccommodationCode,
  findConnectingRoute,
} from '../src/operators/oceanjet/config.js';

describe('resolveStationCode', () => {
  it('maps Bohol to TAG', () => {
    expect(resolveStationCode('Bohol')).toBe('TAG');
  });

  it('maps Tagbilaran to TAG', () => {
    expect(resolveStationCode('Tagbilaran')).toBe('TAG');
  });

  it('maps Cebu to CEB', () => {
    expect(resolveStationCode('Cebu')).toBe('CEB');
  });

  it('maps Siquijor to SIQ', () => {
    expect(resolveStationCode('Siquijor')).toBe('SIQ');
  });

  it('maps Larena, Siquijor to SIQ', () => {
    expect(resolveStationCode('Larena, Siquijor')).toBe('SIQ');
  });

  it('maps Dumaguete to DUM', () => {
    expect(resolveStationCode('Dumaguete')).toBe('DUM');
  });

  it('maps Surigao to SUR', () => {
    expect(resolveStationCode('Surigao')).toBe('SUR');
  });

  it('maps Maasin to MAA', () => {
    expect(resolveStationCode('Maasin')).toBe('MAA');
  });

  // Real API city names
  it('maps "Tagbilaran City, Bohol Island" to TAG', () => {
    expect(resolveStationCode('Tagbilaran City, Bohol Island')).toBe('TAG');
  });

  it('maps "Maasin City, Leyte" to MAA', () => {
    expect(resolveStationCode('Maasin City, Leyte')).toBe('MAA');
  });

  it('is case-insensitive', () => {
    expect(resolveStationCode('CEBU')).toBe('CEB');
    expect(resolveStationCode('cebu')).toBe('CEB');
  });

  it('returns undefined for unknown city', () => {
    expect(resolveStationCode('Manila')).toBeUndefined();
  });
});

describe('resolveAccommodationCode', () => {
  // Real API values (product.lineClass)
  it('maps Tourist to TC', () => {
    expect(resolveAccommodationCode('Tourist')).toBe('TC');
  });

  it('maps Business to BC', () => {
    expect(resolveAccommodationCode('Business')).toBe('BC');
  });

  it('maps Open Air to OA', () => {
    expect(resolveAccommodationCode('Open Air')).toBe('OA');
  });

  // Reference sheet names (backwards compat)
  it('maps Tourist Class to TC', () => {
    expect(resolveAccommodationCode('Tourist Class')).toBe('TC');
  });

  it('maps Open-Air to OA', () => {
    expect(resolveAccommodationCode('Open-Air')).toBe('OA');
  });

  it('is case-insensitive', () => {
    expect(resolveAccommodationCode('tourist')).toBe('TC');
  });
});

describe('findConnectingRoute', () => {
  it('finds Cebu to Siquijor via Tagbilaran', () => {
    const route = findConnectingRoute('CEB', 'SIQ');
    expect(route).toBeDefined();
    expect(route!.hub).toBe('TAG');
    expect(route!.leg1.origin).toBe('CEB');
    expect(route!.leg1.destination).toBe('TAG');
    expect(route!.leg1.departureTime).toBe('13:00');
    expect(route!.leg2.origin).toBe('TAG');
    expect(route!.leg2.destination).toBe('SIQ');
    expect(route!.leg2.departureTime).toBe('15:20');
  });

  it('finds Cebu to Surigao via Maasin', () => {
    const route = findConnectingRoute('CEB', 'SUR');
    expect(route).toBeDefined();
    expect(route!.hub).toBe('MAA');
  });

  it('returns undefined for direct route', () => {
    expect(findConnectingRoute('CEB', 'TAG')).toBeUndefined();
  });
});

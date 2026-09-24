import { describe, expect, it } from 'vitest';
import { bearingDegrees, clampBounds, compassLabel, gridKey, haversineMeters, isValidLatLon, normalizeDegrees, normalizeLongitude } from '../src/geo.ts';

describe('geo helpers (ported from WorldView world-model/geo.ts)', () => {
  it('normalises longitudes into [-180, 180]', () => {
    expect(normalizeLongitude(190)).toBe(-170);
    expect(normalizeLongitude(-190)).toBe(170);
    expect(normalizeLongitude(180)).toBe(180);
    expect(normalizeLongitude(-180)).toBe(-180);
    expect(normalizeLongitude(540)).toBe(180);
    expect(normalizeLongitude(0)).toBe(0);
  });

  it('validates lat/lon pairs', () => {
    expect(isValidLatLon(21.397, -157.727)).toBe(true);
    expect(isValidLatLon(91, 0)).toBe(false);
    expect(isValidLatLon(0, 181)).toBe(false);
    expect(isValidLatLon(Number.NaN, 0)).toBe(false);
    expect(isValidLatLon('21', 0)).toBe(false);
  });

  it('measures Kailua → Honolulu at roughly 18 km', () => {
    const d = haversineMeters({ latitude: 21.397, longitude: -157.727 }, { latitude: 21.3069, longitude: -157.8583 });
    expect(d).toBeGreaterThan(16_000);
    expect(d).toBeLessThan(18_500);
  });

  it('computes bearings clockwise from north', () => {
    const origin = { latitude: 0, longitude: 0 };
    expect(bearingDegrees(origin, { latitude: 1, longitude: 0 })).toBeCloseTo(0, 5);
    expect(bearingDegrees(origin, { latitude: 0, longitude: 1 })).toBeCloseTo(90, 5);
    expect(bearingDegrees(origin, { latitude: -1, longitude: 0 })).toBeCloseTo(180, 5);
    expect(bearingDegrees(origin, { latitude: 0, longitude: -1 })).toBeCloseTo(270, 5);
  });

  it('wraps degrees and labels compass points', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(720)).toBe(0);
    expect(compassLabel(0)).toBe('N');
    expect(compassLabel(157.5)).toBe('SSE');
    expect(compassLabel(359)).toBe('N');
    expect(compassLabel(135, 8)).toBe('SE');
  });

  it('clamps bounds to the globe', () => {
    expect(clampBounds({ west: -181, south: -91, east: 181, north: 91 })).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });

  it('quantises cache grid keys so nearby pins share a cell', () => {
    const a = gridKey({ latitude: 21.397, longitude: -157.727 });
    const b = gridKey({ latitude: 21.41, longitude: -157.74 });
    const c = gridKey({ latitude: 21.5, longitude: -157.727 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

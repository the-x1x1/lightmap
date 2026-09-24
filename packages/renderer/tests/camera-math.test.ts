import { describe, expect, it } from 'vitest';
import {
  altitudeForBounds,
  altitudeToZoom,
  clampOrbit,
  normalizeHeadingDegrees,
  zoomToAltitudeM,
} from '../src/camera-math.ts';

describe('camera math (ported from WorldView view.ts / contract.ts)', () => {
  it('normalises headings', () => {
    expect(normalizeHeadingDegrees(-10)).toBe(350);
    expect(normalizeHeadingDegrees(370)).toBe(10);
    expect(normalizeHeadingDegrees(360)).toBe(0);
  });
  it('zoom ↔ altitude round-trips and is monotone', () => {
    for (const z of [2, 8, 12, 16])
      expect(altitudeToZoom(zoomToAltitudeM(z, 21.4), 21.4)).toBeCloseTo(z, 6);
    expect(zoomToAltitudeM(10)).toBeGreaterThan(zoomToAltitudeM(14));
    expect(zoomToAltitudeM(30)).toBe(10); // floor
    expect(altitudeToZoom(1e12)).toBe(0);
    expect(altitudeToZoom(0.001)).toBe(22);
  });
  it('frames bounds with a margin', () => {
    const alt = altitudeForBounds({ west: -157.8, south: 21.3, east: -157.6, north: 21.5 });
    expect(alt).toBeGreaterThan(20_000);
    expect(alt).toBeLessThan(30_000);
    expect(altitudeForBounds({ west: 0, south: 0, east: 0.0001, north: 0.0001 })).toBe(500);
    // Dateline-crossing bounds.
    expect(altitudeForBounds({ west: 179, south: -1, east: -179, north: 1 })).toBeGreaterThan(
      200_000,
    );
  });
  it('clamps orbit views', () => {
    expect(clampOrbit({ headingDeg: 400, pitchDeg: 10, rangeM: 1 })).toEqual({
      headingDeg: 40,
      pitchDeg: -5,
      rangeM: 50,
    });
    expect(clampOrbit({ headingDeg: 0, pitchDeg: -95, rangeM: 1e9 }).pitchDeg).toBe(-89);
  });
});

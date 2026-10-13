import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aboveHorizon,
  countryDistanceBandM,
  parsePlaceLabels,
  placeMaxDistanceM,
  zoomToDistanceM,
} from '../src/place-labels.ts';

const ecef = (latDeg: number, lonDeg: number, h = 0) => {
  const a = 6378137;
  const e2 = 0.00669437999014;
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return {
    x: (n + h) * Math.cos(lat) * Math.cos(lon),
    y: (n + h) * Math.cos(lat) * Math.sin(lon),
    z: (n * (1 - e2) + h) * Math.sin(lat),
  };
};

describe('place labels', () => {
  it('parses the compact rows and skips anything malformed', () => {
    const set = parsePlaceLabels({
      places: [
        ['Honolulu', 21.307, -157.858, 3.7, 0],
        ['Tokyo', 35.685, 139.751, 1.7, 1],
        ['Nowhere', 95, 0, 3, 0],
        ['Bad', 'x', 0, 3, 0],
        'junk',
      ],
      countries: [
        ['Japan', 36.4, 138.2, 2.5],
        ['Broken', 0],
      ],
    });
    expect(set.places.map((p) => p.name)).toEqual(['Honolulu', 'Tokyo']);
    expect(set.places[1]!.capital).toBe(true);
    expect(set.countries).toEqual([
      { name: 'Japan', latitude: 36.4, longitude: 138.2, minLabel: 2.5 },
    ]);
    expect(parsePlaceLabels(null)).toEqual({ places: [], countries: [] });
  });

  it('turns zoom into distance: world cities from orbit, towns within a couple of hundred km', () => {
    expect(zoomToDistanceM(2)).toBeCloseTo(6.5e6, -3);
    expect(zoomToDistanceM(7)).toBeCloseTo(203125, 0);
    expect(placeMaxDistanceM({ minZoom: 2, capital: true })).toBeGreaterThan(
      placeMaxDistanceM({ minZoom: 2, capital: false }),
    );
    const [near, far] = countryDistanceBandM({ minLabel: 2 });
    expect(near).toBe(6e5);
    expect(far).toBeGreaterThan(1e7);
    expect(countryDistanceBandM({ minLabel: 6 })[1]).toBeLessThan(far);
  });

  it('hides a point behind the Earth and keeps one facing the camera, exactly at the limb', () => {
    const cam = ecef(21.3, -157.9, 2e7);
    expect(aboveHorizon(ecef(21.3, -157.9), cam)).toBe(true);
    expect(aboveHorizon(ecef(35.7, 139.8), cam)).toBe(true); // Tokyo from above Hawaii, far out
    expect(aboveHorizon(ecef(48.9, 2.35), cam)).toBe(false); // Paris is on the far side
    // From 400 km up the horizon is ~20° of arc (≈ 2 200 km) away: 25° is beyond it, 15° is not.
    const low = ecef(0, 0, 4e5);
    expect(aboveHorizon(ecef(0, 25), low)).toBe(false);
    expect(aboveHorizon(ecef(0, 15), low)).toBe(true);
    // Polar points work on the flattened ellipsoid too.
    expect(aboveHorizon(ecef(89.9, 0), ecef(90, 0, 1e6))).toBe(true);
  });

  it('the bundled file parses whole: thousands of places, every country, capitals among them', () => {
    const raw = JSON.parse(
      readFileSync(
        new URL('../../../apps/web/public/data/place-labels.json', import.meta.url),
        'utf8',
      ),
    ) as { places: unknown[]; countries: unknown[] };
    const set = parsePlaceLabels(raw);
    expect(set.places.length).toBe(raw.places.length);
    expect(set.countries.length).toBe(raw.countries.length);
    expect(set.places.length).toBeGreaterThan(5000);
    expect(set.countries.length).toBeGreaterThan(170);
    expect(set.places.filter((p) => p.capital).length).toBeGreaterThan(150);
    expect(set.places.some((p) => p.name === 'Honolulu')).toBe(true);
  });
});

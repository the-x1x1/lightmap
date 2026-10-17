import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeUrbanCell, urbanCellsFor, type UrbanPolygon } from '../src/urban-areas.ts';
import { describeSkyGlow, skyGlowAt } from '../src/sky-glow.ts';

/** A square town of `sideKm` centred `eastKm`/`northKm` from (lat, lon). */
function town(lat: number, lon: number, eastKm: number, northKm: number, sideKm: number) {
  const ky = 111.195;
  const kx = ky * Math.cos((lat * Math.PI) / 180);
  const h = sideKm / 2;
  const p = (e: number, n: number): [number, number] => [lon + e / kx, lat + n / ky];
  return [
    [
      p(eastKm - h, northKm - h),
      p(eastKm + h, northKm - h),
      p(eastKm + h, northKm + h),
      p(eastKm - h, northKm + h),
    ],
  ] as UrbanPolygon;
}

const base = new URL('../../../apps/web/public/data/urban/', import.meta.url);
function polygonsAround(lat: number, lon: number): UrbanPolygon[] {
  const d = 2.5;
  const dx = d / Math.cos((lat * Math.PI) / 180);
  return urbanCellsFor({ west: lon - dx, east: lon + dx, south: lat - d, north: lat + d })
    .filter((k) => existsSync(new URL(`${k}.json`, base)))
    .flatMap((k) =>
      decodeUrbanCell(JSON.parse(readFileSync(new URL(`${k}.json`, base), 'utf8')), k),
    );
}

describe('sky glow from the urban areas (Walker’s law)', () => {
  it('nothing around: a dark sky, no direction', () => {
    const g = skyGlowAt(30, -100, []);
    expect(g).toEqual({ grade: 'dark', index: 0, bearingDeg: null, distanceKm: null });
    expect(describeSkyGlow(g)).toBe('no mapped town lights the sky');
  });

  it('inside a town is a city sky', () => {
    const g = skyGlowAt(30, -100, [town(30, -100, 0, 0, 10)]);
    expect(g.grade).toBe('city');
    expect(g.distanceKm).toBe(0);
    expect(describeSkyGlow(g)).toMatch(/washed out/);
  });

  it('falls with distance to the power 2.5 and points at the town', () => {
    const near = skyGlowAt(30, -100, [town(30, -100, 30, 0, 20)]);
    const far = skyGlowAt(30, -100, [town(30, -100, 60, 0, 20)]);
    // Edge distances 20 and 50 km: (50/20)^2.5 ~ 9.9.
    expect(near.index / far.index).toBeCloseTo((50 / 20) ** 2.5, 0);
    expect(near.distanceKm).toBeCloseTo(20, 0);
    expect(near.bearingDeg).toBeCloseTo(90, 0);
    expect(describeSkyGlow(near)).toMatch(/to the E/);
  });

  it('a bigger town glows more, and towns add up', () => {
    const small = skyGlowAt(30, -100, [town(30, -100, 0, -40, 10)]);
    const big = skyGlowAt(30, -100, [town(30, -100, 0, -40, 30)]);
    expect(big.index).toBeGreaterThan(small.index * 5);
    expect(big.bearingDeg).toBeCloseTo(180, 0);
    const both = skyGlowAt(30, -100, [town(30, -100, 0, -40, 10), town(30, -100, 40, 0, 10)]);
    expect(both.index).toBeGreaterThan(small.index * 1.5);
  });

  it('beyond the reach a town adds nothing', () => {
    expect(skyGlowAt(30, -100, [town(30, -100, 400, 0, 40)]).index).toBe(0);
  });

  it('grades known skies from the bundled data (Bortle class from dark-sky surveys)', () => {
    const grade = (lat: number, lon: number) => skyGlowAt(lat, lon, polygonsAround(lat, lon)).grade;
    // Bortle 8-9.
    expect(grade(40.758, -73.9855)).toBe('city'); // Times Square
    expect(grade(48.8, 2.13)).toBe('city'); // Versailles
    // Bortle 5-6, a few km from Las Vegas.
    expect(grade(36.135, -115.43)).toBe('suburban'); // Red Rock Canyon
    // Bortle 4: Long Island's tip, the New York dome low in the west.
    expect(grade(41.071, -71.857)).toBe('horizon'); // Montauk Point
    // Bortle 1-2.
    for (const [lat, lon] of [
      [29.25, -103.25], // Big Bend
      [19.82, -155.47], // Mauna Kea
      [36.06, -112.11], // Grand Canyon South Rim
      [37.6, -112.17], // Bryce Canyon
    ] as const)
      expect(grade(lat, lon)).toBe('dark');
  });
});

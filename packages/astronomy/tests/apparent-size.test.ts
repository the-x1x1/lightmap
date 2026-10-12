import { describe, expect, it } from 'vitest';
import {
  MEAN_LUNAR_DISTANCE_KM,
  apparentDiameterDeg,
  fullMoonsAhead,
  moonApparentDiameterDeg,
  moonSizeVsMean,
  sunApparentDiameterDeg,
  topocentricDistanceKm,
} from '../src/apparent-size.ts';
import { lunarEquatorial } from '../src/lunar.ts';
import { julianCenturiesTT } from '../src/time.ts';

const arcmin = (deg: number) => deg * 60;

describe('apparent diameters', () => {
  it('matches the almanac means: the Sun 32.0′ at 1 AU, the Moon 31.1′ at its mean distance', () => {
    expect(arcmin(sunApparentDiameterDeg(1))).toBeCloseTo(31.98, 1);
    expect(arcmin(moonApparentDiameterDeg(MEAN_LUNAR_DISTANCE_KM))).toBeCloseTo(31.08, 1);
  });

  it('spans perigee to apogee: ≈ 0.56° at 356 500 km, ≈ 0.49° at 406 700 km, a 14 % spread', () => {
    const peri = moonApparentDiameterDeg(356_500);
    const apo = moonApparentDiameterDeg(406_700);
    expect(peri).toBeCloseTo(0.5585, 3);
    expect(apo).toBeCloseTo(0.4895, 3);
    expect(peri / apo - 1).toBeCloseTo(0.141, 2);
    expect(moonSizeVsMean(356_500)).toBeCloseTo(0.078, 2);
    expect(moonSizeVsMean(406_700)).toBeCloseTo(-0.055, 2);
    expect(moonSizeVsMean(MEAN_LUNAR_DISTANCE_KM)).toBe(0);
  });

  it('the Sun at perihelion and aphelion differs by 3.4 %', () => {
    expect(sunApparentDiameterDeg(0.9833) / sunApparentDiameterDeg(1.0167) - 1).toBeCloseTo(
      0.034,
      3,
    );
  });

  it('observer offset: one Earth radius nearer at the zenith, the chord at the horizon, wider when high', () => {
    const d = 384_399;
    expect(topocentricDistanceKm(d, 90)).toBeCloseTo(d - 6371, 6);
    expect(topocentricDistanceKm(d, 0)).toBeCloseTo(Math.sqrt(d * d - 6371 * 6371), 6);
    expect(topocentricDistanceKm(d, -90)).toBeCloseTo(d + 6371, 6);
    const zenith = moonApparentDiameterDeg(d, 90);
    const horizon = moonApparentDiameterDeg(d, 0);
    expect(zenith / horizon - 1).toBeCloseTo(0.0168, 3);
    expect(moonApparentDiameterDeg(d)).toBeCloseTo(apparentDiameterDeg(1737.4, d), 12);
  });
});

describe('full Moons ahead', () => {
  it("2025: the November full Moon is the year's closest (356 980 km) and April's the farthest", () => {
    const r = fullMoonsAhead(new Date('2025-01-01T00:00:00Z'), 12);
    expect(r.moons).toHaveLength(12);
    const closest = r.moons[r.closest]!;
    const farthest = r.moons[r.farthest]!;
    expect(closest.at.toISOString().slice(0, 10)).toBe('2025-11-05');
    expect(Math.abs(closest.distanceKm - 356_980)).toBeLessThan(400);
    expect(closest.sizeVsMean).toBeGreaterThan(0.07);
    expect(farthest.at.toISOString().slice(0, 10)).toBe('2025-04-13');
    expect(Math.abs(farthest.distanceKm - 406_000)).toBeLessThan(400);
    expect(farthest.sizeVsMean).toBeLessThan(-0.05);
  });

  it('lists the next twelve in order, a lunation apart, each at its own geocentric distance', () => {
    const from = new Date('2026-10-11T00:00:00Z');
    const r = fullMoonsAhead(from, 12);
    expect(r.moons).toHaveLength(12);
    expect(r.moons[0]!.at.getTime()).toBeGreaterThan(from.getTime());
    for (let i = 0; i < r.moons.length; i++) {
      const m = r.moons[i]!;
      expect(m.distanceKm).toBeCloseTo(lunarEquatorial(julianCenturiesTT(m.at)).distanceKm, 6);
      expect(m.sizeVsMean).toBeCloseTo(moonSizeVsMean(m.distanceKm), 12);
      if (i > 0) {
        const gapDays = (m.at.getTime() - r.moons[i - 1]!.at.getTime()) / 86_400_000;
        expect(gapDays).toBeGreaterThan(29);
        expect(gapDays).toBeLessThan(30.1);
      }
    }
    expect(r.moons[r.closest]!.distanceKm).toBe(Math.min(...r.moons.map((m) => m.distanceKm)));
    expect(r.moons[r.farthest]!.distanceKm).toBe(Math.max(...r.moons.map((m) => m.distanceKm)));
  });

  it('asks for fewer and gets fewer; none gives no indices', () => {
    expect(fullMoonsAhead(new Date('2026-01-01T00:00:00Z'), 3).moons).toHaveLength(3);
    const none = fullMoonsAhead(new Date('2026-01-01T00:00:00Z'), 0);
    expect(none.moons).toEqual([]);
    expect(none.closest).toBe(-1);
    expect(none.farthest).toBe(-1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  angularSeparationDeg,
  planetGeocentric,
  planetMagnitude,
  planetPositions,
} from '../src/planets.ts';
import { julianCenturiesTT } from '../src/time.ts';
import { sunPosition } from '../src/solar.ts';

const at = (iso: string) => julianCenturiesTT(new Date(iso));

// V&V against published events (elongations and magnitudes as the almanacs list them).
describe('planet places against published events', () => {
  it("Venus's greatest elongations: 45.4 deg on 4 Jun 2023, 47.2 deg on 10 Jan 2025", () => {
    expect(planetGeocentric('venus', at('2023-06-04T12:00Z')).elongationDeg).toBeCloseTo(45.4, 0);
    expect(planetGeocentric('venus', at('2025-01-10T12:00Z')).elongationDeg).toBeCloseTo(47.2, 0);
    expect(planetGeocentric('venus', at('2023-06-04T12:00Z')).magnitude).toBeLessThan(-4.2);
  });

  it("Mercury's greatest eastern elongation of 24 Mar 2024: 18.7 deg", () => {
    const m = planetGeocentric('mercury', at('2024-03-24T12:00Z'));
    expect(Math.abs(m.elongationDeg - 18.7)).toBeLessThan(0.3);
  });

  it('oppositions: Mars 16 Jan 2025 (-1.4), Jupiter 10 Jan 2026 (-2.7), Saturn 21 Sep 2025 (+0.6)', () => {
    const mars = planetGeocentric('mars', at('2025-01-16T12:00Z'));
    expect(mars.elongationDeg).toBeGreaterThan(174);
    expect(Math.abs(mars.magnitude + 1.4)).toBeLessThan(0.15);
    const jup = planetGeocentric('jupiter', at('2026-01-10T12:00Z'));
    expect(jup.elongationDeg).toBeGreaterThan(178);
    expect(Math.abs(jup.magnitude + 2.7)).toBeLessThan(0.15);
    const sat = planetGeocentric('saturn', at('2025-09-21T12:00Z'));
    expect(sat.elongationDeg).toBeGreaterThan(176);
    expect(Math.abs(sat.magnitude - 0.6)).toBeLessThan(0.2);
  });

  it('conjunctions: Jupiter-Saturn 6.1 arcmin on 21 Dec 2020, Venus-Jupiter 0.5 deg on 2 Mar 2023', () => {
    const t = at('2020-12-21T18:00Z');
    const js = angularSeparationDeg(planetGeocentric('jupiter', t), planetGeocentric('saturn', t));
    expect(Math.abs(js - 6.1 / 60)).toBeLessThan(0.03);
    const t2 = at('2023-03-02T00:00Z');
    const vj = angularSeparationDeg(planetGeocentric('venus', t2), planetGeocentric('jupiter', t2));
    expect(Math.abs(vj - 0.5)).toBeLessThan(0.1);
  });
});

describe('planetPositions', () => {
  it('gives the five planets for an observer, Venus in the west after a June 2023 sunset', () => {
    // Kailua, Oahu, 4 Jun 2023 19:30 HST (05:30 UTC on the 5th).
    const date = new Date('2023-06-05T05:30:00Z');
    const list = planetPositions(date, 21.4, -157.74);
    expect(list.map((p) => p.name)).toEqual(['mercury', 'venus', 'mars', 'jupiter', 'saturn']);
    const venus = list.find((p) => p.name === 'venus')!;
    expect(sunPosition(date, 21.4, -157.74).elevationDeg).toBeLessThan(0);
    expect(venus.elevationDeg).toBeGreaterThan(25);
    expect(venus.azimuthDeg).toBeGreaterThan(270);
    expect(venus.azimuthDeg).toBeLessThan(310);
  });

  it("Saturn's rings brighten it as they open", () => {
    expect(planetMagnitude('saturn', 9.5, 8.5, 5, 26)).toBeLessThan(
      planetMagnitude('saturn', 9.5, 8.5, 5, 0) - 0.7,
    );
  });
});

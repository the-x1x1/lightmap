import { describe, expect, it } from 'vitest';
import {
  lunarArguments,
  lunarEquatorial,
  lunarPeriodicSums,
  moonHorizonThresholdDeg,
  moonPosition,
  moonRiseSet,
  topocentricEquatorial,
} from '../src/lunar.ts';
import { toHorizontal } from '../src/solar.ts';
import { julianCenturiesTT } from '../src/time.ts';

/**
 * Meeus, Astronomical Algorithms, Example 47.a: 1992 April 12, 0h TD (JDE 2448724.5),
 * T = −0.077221081451. Every intermediate value below is printed in the book, so a single wrong
 * table coefficient shows up as a mismatch in the sums.
 */
const T = -0.077221081451;

describe('Moon — Meeus example 47.a', () => {
  it('fundamental arguments', () => {
    const a = lunarArguments(T);
    expect(a.Lp).toBeCloseTo(134.290182, 5);
    expect(a.D).toBeCloseTo(113.842304, 5);
    expect(a.M).toBeCloseTo(97.643514, 5);
    expect(a.Mp).toBeCloseTo(5.150833, 5);
    expect(a.F).toBeCloseTo(219.889721, 5);
    expect(a.A1).toBeCloseTo(109.57, 2);
    expect(a.A2).toBeCloseTo(123.78, 2);
    expect(a.A3).toBeCloseTo(229.53, 2);
    expect(a.E).toBeCloseTo(1.000194, 6);
  });
  it('periodic sums to the unit of the published tables', () => {
    const s = lunarPeriodicSums(T);
    expect(Math.round(s.sumL)).toBe(-1127527);
    expect(Math.round(s.sumB)).toBe(-3229126);
    expect(Math.round(s.sumR)).toBe(-16590875);
  });
  it('apparent longitude, latitude, distance, parallax and equatorial coordinates', () => {
    const m = lunarEquatorial(T);
    expect(m.eclipticLongitudeDeg).toBeCloseTo(133.167265, 3); // λ 133.162655 + Δψ 0.004610
    expect(m.eclipticLatitudeDeg).toBeCloseTo(-3.229126, 5);
    expect(m.distanceKm).toBeCloseTo(368409.7, 0);
    expect(m.parallaxDeg).toBeCloseTo(0.99199, 4);
    expect(m.rightAscensionDeg).toBeCloseTo(134.68847, 3);
    expect(m.declinationDeg).toBeCloseTo(13.768368, 3);
  });
});

describe('moonrise / moonset threshold', () => {
  it('at the reported moonrise the topocentric centre sits a semidiameter plus refraction below the horizon', () => {
    const lat = 21.397;
    const lon = -157.727;
    const day = new Date('2026-05-31T10:00:00Z'); // 00:00 HST
    const { moonrise, moonset } = moonRiseSet(day, new Date(day.getTime() + 86_400_000), lat, lon);
    expect(moonrise).not.toBeNull();
    expect(moonset).not.toBeNull();
    for (const t of [moonrise!, moonset!]) {
      const m = moonPosition(t, lat, lon);
      // Centre at −(0.2725π + 34′) ≈ −0.83°, within the 10 s bisection.
      expect(m.topocentricElevationDeg).toBeCloseTo(moonHorizonThresholdDeg(m.distanceKm), 1);
      expect(moonHorizonThresholdDeg(m.distanceKm)).toBeLessThan(-0.8);
      expect(moonHorizonThresholdDeg(m.distanceKm)).toBeGreaterThan(-0.86);
    }
    // Near full moon the Moon rises around sunset: 18:40–20:00 HST on 31 May 2026.
    const riseHst = (moonrise!.getTime() - day.getTime()) / 3_600_000;
    expect(riseHst).toBeGreaterThan(18.6);
    expect(riseHst).toBeLessThan(20.1);
  });
});

describe('topocentric correction (Meeus ch. 40)', () => {
  it('lowers the Moon by about its parallax near the horizon and shifts its azimuth at mid-latitudes', () => {
    const lat = 51.5;
    const lon = -0.1;
    const t = new Date('2026-05-31T22:00:00Z');
    const T = julianCenturiesTT(t);
    const geo = lunarEquatorial(T);
    const geoHz = toHorizontal(geo, t, lat, lon);
    const topoHz = toHorizontal(topocentricEquatorial(geo, t, lat, lon), t, lat, lon);
    const expectedDrop = geo.parallaxDeg * Math.cos((geoHz.elevationDeg * Math.PI) / 180);
    expect(geoHz.elevationDeg - topoHz.elevationDeg).toBeCloseTo(expectedDrop, 2);
    // The azimuth shift is real and bounded by the parallax.
    const dAz = Math.abs((((topoHz.azimuthDeg - geoHz.azimuthDeg) % 360) + 540) % 360) - 180;
    expect(Math.abs(dAz)).toBeLessThan(geo.parallaxDeg);
    // moonPosition reports the topocentric values.
    const mp = moonPosition(t, lat, lon);
    expect(mp.elevationDeg).toBeCloseTo(topoHz.elevationDeg, 9);
    expect(mp.topocentricElevationDeg).toBeCloseTo(topoHz.elevationDeg, 9);
    expect(mp.azimuthDeg).toBeCloseTo(topoHz.azimuthDeg, 9);
  });
  it('vanishes at the Earth’s centre line of sight: an observer at the equator with the Moon overhead', () => {
    // Parallax in altitude is π·cos h → ~0 at the zenith; the correction cannot invent a shift there.
    const lat = 0;
    const lon = 0;
    for (let h = 0; h < 48; h++) {
      const t = new Date(Date.UTC(2026, 5, 1, h * 0.5));
      const T = julianCenturiesTT(t);
      const geo = lunarEquatorial(T);
      const geoHz = toHorizontal(geo, t, lat, lon);
      if (geoHz.elevationDeg > 85) {
        const topoHz = toHorizontal(topocentricEquatorial(geo, t, lat, lon), t, lat, lon);
        expect(Math.abs(geoHz.elevationDeg - topoHz.elevationDeg)).toBeLessThan(0.1);
      }
    }
  });
});

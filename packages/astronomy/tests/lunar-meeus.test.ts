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
import { apparentSiderealTimeDeg, toHorizontal } from '../src/solar.ts';
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
    // λ 133.162655 + Δψ: the book's full nutation gives 0.004610°, the short form here 0.004578°.
    expect(m.eclipticLongitudeDeg).toBeCloseTo(133.167265, 3);
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
      expect(m.topocentricElevationDeg).toBeCloseTo(moonHorizonThresholdDeg(m.distanceKm), 2);
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
  it('is purely vertical: with the Moon at the zenith the correction cannot shift it', () => {
    // Put an observer directly under the Moon: latitude = its declination, longitude such that
    // the hour angle is zero. Then parallax in altitude (π·cos h) is ~0 and azimuth is moot.
    const t = new Date('2026-06-01T12:00:00Z');
    const T = julianCenturiesTT(t);
    const geo = lunarEquatorial(T);
    const lat = geo.declinationDeg;
    const lon = ((geo.rightAscensionDeg - apparentSiderealTimeDeg(t) + 540) % 360) - 180;
    const geoHz = toHorizontal(geo, t, lat, lon);
    expect(geoHz.elevationDeg).toBeGreaterThan(89.9);
    const topoHz = toHorizontal(topocentricEquatorial(geo, t, lat, lon), t, lat, lon);
    expect(Math.abs(geoHz.elevationDeg - topoHz.elevationDeg)).toBeLessThan(0.02);
  });
  it('beats the first-order altitude form by the second-order term, up to ~0.01° at mid altitudes', () => {
    const lat = 0;
    const lon = 0;
    let worst = 0;
    for (let h = 0; h < 24 * 30; h++) {
      const t = new Date(Date.UTC(2026, 5, 1, h));
      const T = julianCenturiesTT(t);
      const geo = lunarEquatorial(T);
      const geoHz = toHorizontal(geo, t, lat, lon);
      if (geoHz.elevationDeg < 0) continue;
      const firstOrder =
        geoHz.elevationDeg - geo.parallaxDeg * Math.cos((geoHz.elevationDeg * Math.PI) / 180);
      const exact = toHorizontal(topocentricEquatorial(geo, t, lat, lon), t, lat, lon).elevationDeg;
      worst = Math.max(worst, Math.abs(exact - firstOrder));
    }
    expect(worst).toBeGreaterThan(0.004);
    expect(worst).toBeLessThan(0.015);
  });
});

describe("moonrise and moonset against the National Astronomical Observatory of Japan's table", () => {
  // NAO's koyomi for Chiba (35.6000 N, 140.1167 E, UT+9), October 2026, times to the minute.
  // NAO times the Moon's centre on the horizon (altitude -34' with refraction); this app times
  // its upper limb, the semidiameter (~0.26 deg, about 1.5 minutes) earlier at rise and later
  // at set. Rows are [day, rise, set] in local time; '--' is no rise that day.
  const NAO: [number, string, string][] = [
    [1, '20:08', '10:27'],
    [2, '21:07', '11:36'],
    [3, '22:13', '12:38'],
    [4, '23:25', '13:30'],
    [5, '--', '14:13'],
    [6, '0:36', '14:49'],
    [7, '1:46', '15:20'],
    [8, '2:53', '15:48'],
    [9, '3:59', '16:14'],
    [10, '5:02', '16:40'],
  ];
  const lat = 35.6;
  const lon = 140.1167;
  const centreUp = (t: number) =>
    moonPosition(new Date(t), lat, lon).topocentricElevationDeg + 34 / 60;
  /** The crossing of the centre's threshold inside [a, a + 1 min), by bisection. */
  const cross = (a: number) => {
    let lo = a;
    let hi = a + 60_000;
    const below = centreUp(lo) < 0;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (centreUp(m) < 0 === below) lo = m;
      else hi = m;
    }
    return lo;
  };
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  it('times the centre within 45 s of the table (its minute plus rounding), and the upper limb ~1.5 min outside it', () => {
    for (const [day, rise, set] of NAO) {
      const start = Date.UTC(2026, 9, day) - 9 * 3_600_000;
      let r: number | null = null;
      let s: number | null = null;
      for (let t = start; t < start + 86_400_000; t += 60_000) {
        const a = centreUp(t) < 0;
        const b = centreUp(t + 60_000) < 0;
        if (a === b) continue;
        if (a) r = cross(t);
        else s = cross(t);
      }
      const local = (t: number) => (t - start) / 60_000;
      if (rise === '--') expect(r).toBeNull();
      else expect(Math.abs(local(r!) - minutes(rise))).toBeLessThanOrEqual(0.75);
      expect(Math.abs(local(s!) - minutes(set))).toBeLessThanOrEqual(0.75);
      // The app's upper-limb times sit outside the centre's by the semidiameter.
      const limb = moonRiseSet(new Date(start), new Date(start + 86_400_000), lat, lon);
      if (limb.moonrise && r !== null) {
        const lead = (r - limb.moonrise.getTime()) / 60_000;
        expect(lead).toBeGreaterThan(1);
        expect(lead).toBeLessThan(2.5);
      }
      if (limb.moonset && s !== null) {
        const lag = (limb.moonset.getTime() - s) / 60_000;
        expect(lag).toBeGreaterThan(1);
        expect(lag).toBeLessThan(2.5);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  discObscuration,
  eclipsesAhead,
  lunarEclipseAt,
  lunarEclipseHere,
  solarEclipseAt,
} from '../src/eclipses.ts';
import { nextMoonPhases } from '../src/phases.ts';

const utc = (s: string) => new Date(`${s}Z`);
const minutesFrom = (a: Date | null, s: string) =>
  a ? (a.getTime() - utc(s).getTime()) / 60_000 : NaN;
const phaseAfter = (from: string, phase: 'new' | 'full') =>
  nextMoonPhases(utc(from), 4).find((p) => p.phase === phase)!.at;

describe('disc obscuration', () => {
  it('is 0 when the discs do not touch, 1 when one covers the other, the area ratio when annular', () => {
    expect(discObscuration(1, 1, 2.5)).toBe(0);
    expect(discObscuration(1, 1.05, 0)).toBe(1);
    expect(discObscuration(1, 0.9, 0)).toBeCloseTo(0.81, 6);
    // Equal discs, centres one radius apart: the lens covers 39.1 % of each.
    expect(discObscuration(1, 1, 1)).toBeCloseTo(0.391, 3);
  });
});

describe('lunar eclipses (geocentric; NASA eclipse catalogue)', () => {
  it('3 March 2026: total, greatest 11:34 UT, umbral magnitude 1.15, contacts within two minutes', () => {
    const e = lunarEclipseAt(phaseAfter('2026-02-20T00:00:00', 'full'))!;
    expect(e.type).toBe('total');
    expect(Math.abs(minutesFrom(e.greatest, '2026-03-03T11:33:40'))).toBeLessThan(2);
    expect(e.umbralMagnitude).toBeCloseTo(1.151, 1);
    expect(e.penumbralMagnitude).toBeCloseTo(2.199, 1);
    expect(Math.abs(minutesFrom(e.contacts.penumbralStart, '2026-03-03T08:44:00'))).toBeLessThan(2);
    expect(Math.abs(minutesFrom(e.contacts.umbralStart, '2026-03-03T09:50:00'))).toBeLessThan(2);
    expect(Math.abs(minutesFrom(e.contacts.totalStart, '2026-03-03T11:04:00'))).toBeLessThan(2);
    expect(Math.abs(minutesFrom(e.contacts.totalEnd, '2026-03-03T12:03:00'))).toBeLessThan(2);
    expect(Math.abs(minutesFrom(e.contacts.umbralEnd, '2026-03-03T13:17:00'))).toBeLessThan(2);
    expect(Math.abs(minutesFrom(e.contacts.penumbralEnd, '2026-03-03T14:23:00'))).toBeLessThan(3);
  });

  it('28 August 2026: partial, greatest 04:13 UT, umbral magnitude 0.93, no totality contacts', () => {
    const e = lunarEclipseAt(phaseAfter('2026-08-15T00:00:00', 'full'))!;
    expect(e.type).toBe('partial');
    expect(Math.abs(minutesFrom(e.greatest, '2026-08-28T04:13:00'))).toBeLessThan(2);
    expect(e.umbralMagnitude).toBeCloseTo(0.93, 1);
    expect(e.contacts.totalStart).toBeNull();
    expect(e.contacts.umbralStart).not.toBeNull();
  });

  it('a full Moon away from the nodes is not an eclipse at all', () => {
    expect(lunarEclipseAt(phaseAfter('2026-05-20T00:00:00', 'full'))).toBeNull();
  });

  it('"from here": the March 2026 eclipse is up throughout from Honolulu and down throughout from Rome', () => {
    const e = lunarEclipseAt(phaseAfter('2026-02-20T00:00:00', 'full'))!;
    const hnl = lunarEclipseHere(e, { latitude: 21.3, longitude: -157.86 });
    expect(hnl.moonUp).toEqual({ start: true, greatest: true, end: true });
    expect(hnl.moonAtGreatest.elevationDeg).toBeGreaterThan(30);
    const rome = lunarEclipseHere(e, { latitude: 41.9, longitude: 12.5 });
    expect(rome.moonUp).toEqual({ start: false, greatest: false, end: false });
  });
});

describe('solar eclipses at a place (NASA / HM Nautical Almanac Office local circumstances)', () => {
  const newMoon2026 = phaseAfter('2026-08-05T00:00:00', 'new');

  it('12 August 2026 is total in Burgos for about a minute and a half, low in the west', () => {
    const e = solarEclipseAt(newMoon2026, { latitude: 42.34, longitude: -3.7 })!;
    expect(e.type).toBe('total');
    expect(e.magnitude).toBeGreaterThan(1);
    expect(e.obscuration).toBe(1);
    expect(Math.abs(minutesFrom(e.greatest, '2026-08-12T18:29:00'))).toBeLessThan(2);
    const totalS = (e.centralEnd!.getTime() - e.centralStart!.getTime()) / 1000;
    expect(totalS).toBeGreaterThan(70);
    expect(totalS).toBeLessThan(120);
    expect(e.sunAtGreatest.elevationDeg).toBeGreaterThan(5);
    expect(e.sunAtGreatest.elevationDeg).toBeLessThan(12);
    // The Sun sets before the Moon has fully cleared it.
    expect(e.clipped).toEqual({ start: false, end: true });
  });

  it('… partial in London, magnitude 0.92 at 18:13 UT, and nothing at all in Honolulu', () => {
    const e = solarEclipseAt(newMoon2026, { latitude: 51.5, longitude: -0.12 })!;
    expect(e.type).toBe('partial');
    expect(e.magnitude).toBeCloseTo(0.92, 1);
    expect(e.obscuration).toBeGreaterThan(0.85);
    expect(Math.abs(minutesFrom(e.greatest, '2026-08-12T18:13:00'))).toBeLessThan(2);
    expect(e.centralStart).toBeNull();
    expect(e.clipped).toEqual({ start: false, end: false });
    expect(solarEclipseAt(newMoon2026, { latitude: 21.3, longitude: -157.86 })).toBeNull();
  });

  it('a sub-minute totality at the edge of the path still gets its contacts (bisected out from greatest)', () => {
    const e = solarEclipseAt(newMoon2026, { latitude: 80, longitude: -35 })!;
    expect(e.type).toBe('total');
    expect(e.centralStart).not.toBeNull();
    expect(e.centralEnd).not.toBeNull();
    const totalS = (e.centralEnd!.getTime() - e.centralStart!.getTime()) / 1000;
    expect(totalS).toBeGreaterThan(0);
    expect(totalS).toBeLessThan(60);
  });

  it('greatest eclipse at a place where the Sun sets in the middle of it is the sunset second', () => {
    // Rome-ish: the Sun is on the horizon at the deepest coverage.
    const e = solarEclipseAt(newMoon2026, { latitude: 42, longitude: 12 })!;
    expect(e.sunAtGreatest.elevationDeg).toBeGreaterThan(-0.84);
    expect(e.sunAtGreatest.elevationDeg).toBeLessThan(-0.8);
    expect(e.clipped.end).toBe(true);
  });

  it('2 August 2027 is total in Luxor for over six minutes', () => {
    const e = solarEclipseAt(phaseAfter('2027-07-25T00:00:00', 'new'), {
      latitude: 25.69,
      longitude: 32.64,
    })!;
    expect(e.type).toBe('total');
    const totalS = (e.centralEnd!.getTime() - e.centralStart!.getTime()) / 1000;
    expect(totalS).toBeGreaterThan(360);
    expect(totalS).toBeLessThan(400);
    expect(Math.abs(minutesFrom(e.greatest, '2027-08-02T10:05:30'))).toBeLessThan(2);
  });

  it('14 October 2023 was annular in Albuquerque (magnitude 0.97, 90 % obscured) for under five minutes', () => {
    const e = solarEclipseAt(phaseAfter('2023-10-10T00:00:00', 'new'), {
      latitude: 35.08,
      longitude: -106.65,
    })!;
    expect(e.type).toBe('annular');
    expect(e.magnitude).toBeCloseTo(0.974, 2);
    expect(e.obscuration).toBeCloseTo(0.9, 1);
    expect(Math.abs(minutesFrom(e.centralStart, '2023-10-14T16:34:35'))).toBeLessThan(1.5);
    expect(Math.abs(minutesFrom(e.centralEnd, '2023-10-14T16:39:19'))).toBeLessThan(1.5);
  });

  it('8 April 2024 was total in Dallas for about four minutes', () => {
    const e = solarEclipseAt(phaseAfter('2024-04-01T00:00:00', 'new'), {
      latitude: 32.78,
      longitude: -96.8,
    })!;
    expect(e.type).toBe('total');
    expect(Math.abs(minutesFrom(e.centralStart, '2024-04-08T18:40:43'))).toBeLessThan(1.5);
    expect(Math.abs(minutesFrom(e.centralEnd, '2024-04-08T18:44:38'))).toBeLessThan(1.5);
  });
});

describe('eclipsesAhead', () => {
  it('lists 2026–27 from Honolulu in order: two lunar in 2026, three penumbral in 2027, no solar', () => {
    const all = eclipsesAhead(
      { latitude: 21.3, longitude: -157.86 },
      utc('2026-01-01T00:00:00'),
      24,
    );
    expect(all.map((e) => `${e.kind}:${e.type}:${e.greatest.toISOString().slice(0, 10)}`)).toEqual([
      'lunar:total:2026-03-03',
      'lunar:partial:2026-08-28',
      'lunar:penumbral:2027-02-20',
      'lunar:penumbral:2027-07-18',
      'lunar:penumbral:2027-08-17',
    ]);
  });

  it('includes the place’s own solar eclipse: Madrid sees August 2026 and the lunar ones', () => {
    const all = eclipsesAhead({ latitude: 40.42, longitude: -3.7 }, utc('2026-06-01T00:00:00'), 6);
    expect(all.map((e) => `${e.kind}:${e.greatest.toISOString().slice(0, 10)}`)).toEqual([
      'solar:2026-08-12',
      'lunar:2026-08-28',
    ]);
  });

  it('stays within the window asked for', () => {
    const all = eclipsesAhead({ latitude: 40.42, longitude: -3.7 }, utc('2026-04-01T00:00:00'), 3);
    expect(all).toEqual([]);
  });
});

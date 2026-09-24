import { describe, expect, it } from 'vitest';
import { computeDayEvents } from '../src/events.ts';
import { moonPosition } from '../src/lunar.ts';
import { sunPosition } from '../src/solar.ts';
import {
  elevationAtAzimuthByDay,
  findDirectionMatches,
  summarizeRecurrence,
  wrapDelta,
} from '../src/solver.ts';
import { addCivilDays, utcToWallClock, wallClockToUtc } from '../src/time.ts';

const KAILUA = { latitude: 21.397, longitude: -157.727, timeZone: 'Pacific/Honolulu' };
const LONDON = { latitude: 51.5074, longitude: -0.1278, timeZone: 'Europe/London' };
const TROMSO = { latitude: 69.6492, longitude: 18.9553, timeZone: 'Europe/Oslo' };
const SINGAPORE = { latitude: 1.3521, longitude: 103.8198, timeZone: 'Asia/Singapore' };

describe('wrapDelta', () => {
  it('wraps to (−180, 180]', () => {
    expect(wrapDelta(0)).toBe(0);
    expect(wrapDelta(190)).toBe(-170);
    expect(wrapDelta(-190)).toBe(170);
    expect(wrapDelta(180)).toBe(180);
    expect(wrapDelta(-180)).toBe(180);
    expect(wrapDelta(359)).toBe(-1);
  });
});

describe('reverse planning solver', () => {
  it('finds the equinox sunrise due east (independent check: declination ≈ 0 ⇒ azimuth 90°)', () => {
    const r = findDirectionMatches({
      ...LONDON,
      from: { year: 2026, month: 3, day: 1 },
      to: { year: 2026, month: 4, day: 30 },
      target: { azimuthDegrees: 90, elevationDegrees: -0.833, elevationToleranceDegrees: 0.5 },
      minElevationDegrees: -1.5,
    });
    // Near the equinox the rising sun sits within ±2° of azimuth 90° for about a week (the
    // sunrise azimuth drifts ~0.6°/day at London). Both detectors contribute: the bearing crossing
    // (elevation checked) and the horizon crossing (bearing checked).
    const dates = new Set(r.matches.map((m) => m.date));
    expect(dates.size).toBeGreaterThanOrEqual(4);
    expect(dates.size).toBeLessThanOrEqual(9);
    for (const d of dates) expect(d >= '2026-03-13' && d <= '2026-03-25').toBe(true);
    for (const m of r.matches) {
      expect(m.trend).toBe('rising');
      expect(Math.abs(wrapDelta(m.azimuthDegrees - 90))).toBeLessThanOrEqual(2);
      expect(Math.abs(m.elevationDegrees + 0.833)).toBeLessThanOrEqual(0.5);
    }
    expect(r.matches.some((m) => m.via === 'azimuth')).toBe(true);
    expect(r.matches.some((m) => m.via === 'elevation')).toBe(true);
  });

  it('solar-noon elevation on the June solstice at London ≈ 90 − φ + δ (61.9°)', () => {
    const rows = elevationAtAzimuthByDay({
      ...LONDON,
      from: { year: 2026, month: 6, day: 21 },
      to: { year: 2026, month: 6, day: 21 },
      azimuthDegrees: 180,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.elevationDegrees).toBeCloseTo(90 - 51.5074 + 23.44, 0);
    // Solar noon in London (BST) is around 13:02.
    const w = utcToWallClock(rows[0]!.timestampUtc, LONDON.timeZone);
    expect(w.hour).toBe(13);
    expect(Math.abs(w.minute - 2)).toBeLessThanOrEqual(3);
  });

  it('Tromsø midnight sun: the Sun crosses due north above the horizon at ≈ φ + δ − 90 (3.1°)', () => {
    const r = findDirectionMatches({
      ...TROMSO,
      from: { year: 2026, month: 6, day: 21 },
      to: { year: 2026, month: 6, day: 21 },
      target: { azimuthDegrees: 0 },
    });
    expect(r.alignments).toHaveLength(1);
    const a = r.alignments[0]!;
    expect(a.elevationDegrees).toBeCloseTo(69.6492 + 23.44 - 90, 0);
    const w = utcToWallClock(a.timestampUtc, TROMSO.timeZone);
    // Lower transit ≈ local solar midnight; Tromsø is ~1 h ahead of its zone meridian in summer time.
    expect(w.hour === 0 || w.hour === 1).toBe(true);
  });

  it('round trip: the sunset azimuth on 31 May 2026 at Kailua is found on that date with elevation −0.833°', () => {
    const ev = computeDayEvents({ ...KAILUA, date: { year: 2026, month: 5, day: 31 } });
    const sunsetAz = sunPosition(ev.sunset!, KAILUA.latitude, KAILUA.longitude).azimuthDeg;
    const r = findDirectionMatches({
      ...KAILUA,
      from: { year: 2026, month: 5, day: 1 },
      to: { year: 2026, month: 6, day: 30 },
      target: {
        azimuthDegrees: sunsetAz,
        azimuthToleranceDegrees: 0.05,
        elevationDegrees: -0.833,
        elevationToleranceDegrees: 0.05,
      },
      minElevationDegrees: -1,
    });
    const onDate = r.matches.find((m) => m.date === '2026-05-31');
    expect(onDate).toBeDefined();
    expect(Math.abs(onDate!.timestampUtc.getTime() - ev.sunset!.getTime())).toBeLessThan(60_000);
    expect(onDate!.trend).toBe('setting');
    // The same azimuth at the same elevation recurs around the solstice mirror date (≈ 12 July),
    // which is outside the scanned range, so only late May / early June match.
    for (const m of r.matches) expect(m.date >= '2026-05-28' && m.date <= '2026-06-03').toBe(true);
  });

  it('sun behind a ridge: elevation target selects the right dates and reports the error', () => {
    // Ridge bearing 285°, ridge elevation angle 8° from the camera. When does the sun sit on it?
    const r = findDirectionMatches({
      ...KAILUA,
      from: { year: 2026, month: 1, day: 1 },
      to: { year: 2026, month: 12, day: 31 },
      target: { azimuthDegrees: 285, elevationDegrees: 8, elevationToleranceDegrees: 0.75 },
    });
    expect(r.scannedDays).toBe(365);
    expect(r.truncated).toBe(false);
    // At 21.4° N the sunset azimuth only reaches 285° from late April to mid-August, so the sun
    // passes that bearing above the horizon on roughly 160 days (plus the near-zenith sweeps in
    // late May / July), not every day.
    expect(r.alignments.length).toBeGreaterThanOrEqual(120);
    expect(r.alignments.length).toBeLessThanOrEqual(230);
    for (const a of r.alignments)
      expect(a.date >= '2026-04-15' && a.date <= '2026-08-31').toBe(true);
    // It sits within ±2° of that bearing at 8° ± 0.75° in two windows of about two weeks (before
    // and after the solstice); the exact-bearing days are the azimuth-detected ones.
    expect(r.matches.length).toBeGreaterThanOrEqual(10);
    expect(r.matches.length).toBeLessThanOrEqual(40);
    for (const m of r.matches) {
      expect(Math.abs(m.elevationErrorDegrees!)).toBeLessThanOrEqual(0.75);
      expect(Math.abs(wrapDelta(m.azimuthDegrees - 285))).toBeLessThanOrEqual(2);
      expect(m.trend).toBe('setting');
    }
    expect(r.matches.filter((m) => m.via === 'azimuth').length).toBeGreaterThanOrEqual(2);
    const months = new Set(r.matches.map((m) => m.date.slice(5, 7)));
    expect(months.size).toBeGreaterThanOrEqual(2);
  });

  it('tropics: the meridian crossing is never lost, even on near-zenith days', () => {
    // Every day the sun crosses the meridian exactly once at transit: at azimuth 180° when it
    // culminates south of the zenith, at 0° when north. Around 27 May the declination equals the
    // latitude of Kailua and the azimuth sweeps ~180° within minutes — the case a naive
    // "small step" filter drops.
    const range = {
      from: { year: 2026, month: 5, day: 15 },
      to: { year: 2026, month: 6, day: 15 },
    };
    const south = findDirectionMatches({ ...KAILUA, ...range, target: { azimuthDegrees: 180 } });
    const north = findDirectionMatches({ ...KAILUA, ...range, target: { azimuthDegrees: 0 } });
    const days = 32;
    const southDates = new Set(south.alignments.map((a) => a.date));
    const northDates = new Set(north.alignments.map((a) => a.date));
    expect(southDates.size + northDates.size).toBe(days);
    for (const d of southDates) expect(northDates.has(d)).toBe(false);
    for (const a of [...south.alignments, ...north.alignments])
      expect(a.elevationDegrees).toBeGreaterThan(85);
  });

  it('tropics: multiple same-day alignments are all reported and sorted in time', () => {
    const r = findDirectionMatches({
      ...SINGAPORE,
      from: { year: 2026, month: 3, day: 20 },
      to: { year: 2026, month: 3, day: 22 },
      target: { azimuthDegrees: 90 },
      minElevationDegrees: 0,
    });
    expect(r.alignments.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < r.alignments.length; i++)
      expect(r.alignments[i]!.timestampUtc.getTime()).toBeGreaterThan(
        r.alignments[i - 1]!.timestampUtc.getTime(),
      );
    for (const a of r.alignments)
      expect(Math.abs(wrapDelta(a.azimuthDegrees - 90))).toBeLessThan(0.01);
  });

  it('moon: azimuth alignments carry illumination and the filter removes dark phases', () => {
    const range = { from: { year: 2026, month: 5, day: 1 }, to: { year: 2026, month: 6, day: 30 } };
    const all = findDirectionMatches({
      ...KAILUA,
      ...range,
      target: { azimuthDegrees: 110 },
      body: 'moon',
    });
    // The Moon rises around bearing 110° only when its declination is well south, so a two-month
    // range yields a few dozen alignments, not one per day.
    expect(all.alignments.length).toBeGreaterThanOrEqual(15);
    expect(all.alignments.length).toBeLessThanOrEqual(61);
    for (const a of all.alignments) {
      expect(a.body).toBe('moon');
      expect(a.illuminatedFraction).not.toBeNull();
      const check = moonPosition(a.timestampUtc, KAILUA.latitude, KAILUA.longitude);
      expect(Math.abs(wrapDelta(check.azimuthDeg - 110))).toBeLessThan(0.02);
    }
    const bright = findDirectionMatches({
      ...KAILUA,
      ...range,
      target: { azimuthDegrees: 110 },
      body: 'moon',
      minIlluminatedFraction: 0.8,
    });
    // Full moon 31 May 2026: the nearly full Moon rises on that bearing on 26–27 May.
    expect(bright.alignments.length).toBeGreaterThanOrEqual(1);
    expect(bright.alignments.length).toBeLessThan(all.alignments.length);
    for (const a of bright.alignments) expect(a.illuminatedFraction!).toBeGreaterThanOrEqual(0.8);
    expect(bright.alignments.some((a) => a.date === '2026-05-27')).toBe(true);
  });

  it('respects maxDays and rejects inverted ranges', () => {
    const r = findDirectionMatches({
      ...LONDON,
      from: { year: 2026, month: 1, day: 1 },
      to: { year: 2026, month: 12, day: 31 },
      target: { azimuthDegrees: 180 },
      maxDays: 10,
    });
    expect(r.scannedDays).toBe(10);
    expect(r.truncated).toBe(true);
    expect(() =>
      findDirectionMatches({
        ...LONDON,
        from: { year: 2026, month: 2, day: 1 },
        to: { year: 2026, month: 1, day: 1 },
        target: { azimuthDegrees: 180 },
      }),
    ).toThrow(RangeError);
  });

  it('a full year of Sun alignments computes quickly', () => {
    const t0 = performance.now();
    findDirectionMatches({
      ...KAILUA,
      from: { year: 2026, month: 1, day: 1 },
      to: { year: 2026, month: 12, day: 31 },
      target: { azimuthDegrees: 250, elevationDegrees: 10 },
    });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('summarizeRecurrence — "how long does this light last, and when is it back?"', () => {
  const PARIS = { latitude: 48.8566, longitude: 2.3522, timeZone: 'Europe/Paris' };
  /** The Sun's direction at a local wall time, then every match of that direction from the next day. */
  function recurrence(date: { year: number; month: number; day: number }, hour: number) {
    const at = wallClockToUtc({ ...date, hour, minute: 0 }, PARIS.timeZone);
    const s = sunPosition(at, PARIS.latitude, PARIS.longitude);
    const from = addCivilDays(date, 1);
    const r = findDirectionMatches({
      ...PARIS,
      from,
      to: addCivilDays(date, 400),
      target: {
        azimuthDegrees: s.azimuthDeg,
        elevationDegrees: s.elevationDeg,
        azimuthToleranceDegrees: 1.5,
        elevationToleranceDegrees: 0.75,
      },
      minElevationDegrees: -7,
      maxDays: 401,
    });
    return { s, summary: summarizeRecurrence(r.matches, from) };
  }

  it('near the equinox the light lasts a day or two and returns at the mirror date six months on', () => {
    const { summary } = recurrence({ year: 2026, month: 3, day: 20 }, 15);
    // Declination moves ≈ 0.39°/day here, so tomorrow is still within ±0.75° but the day after is not.
    expect(summary.runEnds === '2026-03-21' || summary.runEnds === '2026-03-22').toBe(true);
    expect(summary.next).not.toBeNull();
    // Mirror around the June solstice: the same declination recurs around 22–23 September.
    expect(summary.next!.date >= '2026-09-19' && summary.next!.date <= '2026-09-26').toBe(true);
    // Same hour angle ⇒ same local solar time, within the equation-of-time drift (~15 min).
    const w = utcToWallClock(summary.next!.timestampUtc, PARIS.timeZone);
    expect(Math.abs(w.hour * 60 + w.minute - (15 * 60 + 60))).toBeLessThan(40); // +60: CEST vs CET
  });

  it('near the solstice the light lasts weeks and only returns next year', () => {
    const { summary } = recurrence({ year: 2026, month: 6, day: 21 }, 15);
    expect(summary.runEnds).not.toBeNull();
    // ±0.75° of declination around the solstice spans roughly ±2 weeks.
    expect(summary.runEnds! >= '2026-06-30' && summary.runEnds! <= '2026-07-20').toBe(true);
    expect(summary.next).not.toBeNull();
    expect(summary.next!.date >= '2027-05-25' && summary.next!.date <= '2027-06-20').toBe(true);
  });

  it('is well defined on empty input and does not read anything but `date`', () => {
    const s = summarizeRecurrence([], { year: 2026, month: 1, day: 1 });
    expect(s).toEqual({ runEnds: null, next: null, matchingDays: 0 });
    const t = summarizeRecurrence(
      [{ date: '2026-01-01' }, { date: '2026-01-02' }, { date: '2026-01-09' }],
      { year: 2026, month: 1, day: 1 },
    );
    expect(t.runEnds).toBe('2026-01-02');
    expect(t.next?.date).toBe('2026-01-09');
    expect(t.matchingDays).toBe(3);
    // When `from` itself does not match, the "run" is empty and the next match is the first one.
    const u = summarizeRecurrence([{ date: '2026-01-09' }], { year: 2026, month: 1, day: 1 });
    expect(u.runEnds).toBeNull();
    expect(u.next?.date).toBe('2026-01-09');
  });
});

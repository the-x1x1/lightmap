import { describe, expect, it } from 'vitest';
import {
  addCivilDays,
  civilDateString,
  formatWallTime,
  isValidTimeZone,
  julianDay,
  localDayBounds,
  parseCivilDate,
  utcToWallClock,
  wallClockToUtc,
  zoneOffsetMinutes,
} from '../src/time.ts';

describe('Julian day', () => {
  it('J2000.0 epoch is JD 2451545.0', () => {
    expect(julianDay(new Date('2000-01-01T12:00:00Z'))).toBe(2_451_545.0);
  });
});

describe('wall clock ↔ UTC', () => {
  it('Honolulu has no DST: 12:30 HST is 22:30 UTC', () => {
    const utc = wallClockToUtc(
      { year: 2026, month: 5, day: 31, hour: 12, minute: 30 },
      'Pacific/Honolulu',
    );
    expect(utc.toISOString()).toBe('2026-05-31T22:30:00.000Z');
    const w = utcToWallClock(utc, 'Pacific/Honolulu');
    expect([w.hour, w.minute, w.offsetMinutes, w.zoneAbbreviation]).toEqual([12, 30, -600, 'HST']);
  });

  it('London springs forward on 2026-03-29: 01:30 does not exist and shifts to 02:30 BST', () => {
    const utc = wallClockToUtc(
      { year: 2026, month: 3, day: 29, hour: 1, minute: 30 },
      'Europe/London',
    );
    expect(utc.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(formatWallTime(utc, 'Europe/London')).toBe('02:30');
    expect(zoneOffsetMinutes(new Date('2026-03-29T00:59:00Z'), 'Europe/London')).toBe(0);
    expect(zoneOffsetMinutes(new Date('2026-03-29T01:00:00Z'), 'Europe/London')).toBe(60);
  });

  it('London falls back on 2026-10-25: 01:30 happens twice and resolves to the earlier (BST) instant', () => {
    const utc = wallClockToUtc(
      { year: 2026, month: 10, day: 25, hour: 1, minute: 30 },
      'Europe/London',
    );
    expect(utc.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(utcToWallClock(utc, 'Europe/London').offsetMinutes).toBe(60);
  });

  it('New York DST start 2026-03-08 gives a 23-hour civil day', () => {
    const { start, end } = localDayBounds({ year: 2026, month: 3, day: 8 }, 'America/New_York');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('Kiritimati (UTC+14) and Samoa (UTC+13) sit on the far side of the date line', () => {
    const kiri = wallClockToUtc({ year: 2026, month: 1, day: 15, hour: 12 }, 'Pacific/Kiritimati');
    expect(kiri.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    const apia = wallClockToUtc({ year: 2026, month: 1, day: 15, hour: 12 }, 'Pacific/Apia');
    expect(apia.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    // Same UTC instant, different civil dates either side of the line.
    const instant = new Date('2026-01-15T10:00:00Z');
    expect(utcToWallClock(instant, 'Pacific/Kiritimati').day).toBe(16);
    expect(utcToWallClock(instant, 'Pacific/Honolulu').day).toBe(15);
  });

  it('validates zone ids and civil dates', () => {
    expect(isValidTimeZone('Pacific/Honolulu')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(parseCivilDate('2026-02-29')).toBeNull();
    expect(parseCivilDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseCivilDate('2026-5-31')).toBeNull();
    expect(civilDateString(addCivilDays({ year: 2026, month: 12, day: 31 }, 1))).toBe('2027-01-01');
  });
});

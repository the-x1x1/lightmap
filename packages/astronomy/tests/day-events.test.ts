import { describe, expect, it } from 'vitest';
import { computeDayEvents } from '../src/events.ts';
import { formatWallTime, localDayBounds, wallClockToUtc } from '../src/time.ts';

const at = (d: Date | null, timeZone: string) =>
  d
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d)
    : null;

describe('day events belong to this date’s daylight', () => {
  it('gives Edinburgh in August this evening’s astronomical dusk, after midnight, not last night’s', () => {
    const tz = 'Europe/London';
    const ev = computeDayEvents({
      latitude: 55.95,
      longitude: -3.19,
      date: { year: 2026, month: 8, day: 10 },
      timeZone: tz,
    });
    // The dusk of the night of 10–11 August, and it comes after sunset.
    expect(ev.astronomicalDusk!.getTime()).toBeGreaterThan(ev.sunset!.getTime());
    expect(at(ev.astronomicalDusk, tz)).toMatch(/^11\/08\/2026, 0\d:\d\d$/);
    // And this morning's dawn came before sunrise, on the night before.
    expect(ev.astronomicalDawn!.getTime()).toBeLessThan(ev.sunrise!.getTime());
  });

  it('runs Reykjavik’s late-May evening golden hour forwards, past midnight', () => {
    const ev = computeDayEvents({
      latitude: 64.15,
      longitude: -21.94,
      date: { year: 2026, month: 5, day: 25 },
      timeZone: 'Atlantic/Reykjavik',
    });
    expect(ev.goldenHourEveningStart).not.toBeNull();
    expect(ev.goldenHourEveningEnd).not.toBeNull();
    expect(ev.goldenHourEveningEnd!.getTime()).toBeGreaterThan(
      ev.goldenHourEveningStart!.getTime(),
    );
    expect(ev.sunset!.getTime()).toBeGreaterThan(ev.sunrise!.getTime());
  });

  it('counts Tromsø’s near-midnight-sun daylight in full', () => {
    const ev = computeDayEvents({
      latitude: 69.65,
      longitude: 18.96,
      date: { year: 2026, month: 5, day: 18 },
      timeZone: 'Europe/Oslo',
    });
    // The Sun dips below the horizon for well under an hour around midnight.
    expect(ev.polar).toBe('normal');
    expect(ev.daylightMinutes).toBeGreaterThan(1380);
    expect(ev.daylightMinutes).toBeLessThan(1440);
  });

  it('leaves an ordinary mid-latitude day as it was', () => {
    const tz = 'Europe/London';
    const ev = computeDayEvents({
      latitude: 51.5,
      longitude: -0.13,
      date: { year: 2026, month: 6, day: 21 },
      timeZone: tz,
    });
    expect(at(ev.sunrise, tz)).toBe('21/06/2026, 04:43');
    expect(at(ev.sunset, tz)).toBe('21/06/2026, 21:21');
    expect(Math.round(ev.daylightMinutes)).toBe(998);
  });
});

describe('a wall time in a spring-forward gap shifts forward, east or west of UTC', () => {
  it('New York 02:30 on 8 March 2026 is 03:30 EDT', () => {
    expect(
      wallClockToUtc(
        { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-03-08T07:30:00.000Z');
  });

  it('Santiago’s day of the change starts at 01:00 and is 23 hours long', () => {
    const { start, end } = localDayBounds({ year: 2026, month: 9, day: 6 }, 'America/Santiago');
    expect(start.toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it('London 01:30 on 29 March 2026 is 02:30 BST, as before', () => {
    expect(
      wallClockToUtc(
        { year: 2026, month: 3, day: 29, hour: 1, minute: 30 },
        'Europe/London',
      ).toISOString(),
    ).toBe('2026-03-29T01:30:00.000Z');
  });

  it('rounds event times to the nearest minute', () => {
    expect(formatWallTime(new Date('2026-12-21T21:31:49Z'), 'America/New_York')).toBe('16:32');
    expect(formatWallTime(new Date('2026-12-21T21:31:29Z'), 'America/New_York')).toBe('16:31');
  });
});

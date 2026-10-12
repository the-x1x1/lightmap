import { describe, expect, it } from 'vitest';
import type { WeatherFrame } from '@lightmap/weather';
import {
  darkNights,
  weekAheadCellLabel,
  weekAheadDates,
  weekAheadRows,
  weekAheadText,
} from '../../features/planner/week-ahead.ts';

const kailua = { latitude: 21.397, longitude: -157.727 };
const tz = 'Pacific/Honolulu';

function day(date: string, cloud: number): WeatherFrame[] {
  const out: WeatherFrame[] = [];
  // 30 hourly frames from local midnight, so the evening golden hour is covered.
  const start = Date.parse(`${date}T10:00:00Z`);
  for (let i = 0; i < 30; i++)
    out.push({
      timestamp: new Date(start + i * 3_600_000).toISOString(),
      cloudCoverTotal: cloud,
      cloudCoverLow: cloud,
      cloudCoverMid: 0,
      cloudCoverHigh: 0,
      precipitationProbability: 0,
      precipitationAmount: 0,
      humidity: 60,
      visibility: 30_000,
      windSpeed: 3,
      windDirection: 90,
      weatherCode: cloud > 50 ? 3 : 0,
    });
  return out;
}

describe('week ahead', () => {
  it('lists seven civil dates from the start, across a month end', () => {
    expect(weekAheadDates({ year: 2026, month: 5, day: 29 })).toEqual([
      '2026-05-29',
      '2026-05-30',
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
    ]);
  });

  it('gives each day its golden hours and the forecast verdict, or null without frames', () => {
    const frames = new Map<string, WeatherFrame[]>([
      ['2026-05-31', day('2026-05-31', 5)],
      ['2026-06-01', day('2026-06-01', 95)],
    ]);
    const rows = weekAheadRows(kailua, tz, { year: 2026, month: 5, day: 31 }, frames);
    expect(rows).toHaveLength(7);
    expect(rows[0]!.date).toBe('2026-05-31');
    expect(rows[0]!.weekday).toBe(0); // a Sunday
    expect(rows[0]!.evening?.outlook?.verdict).toBe('clear');
    expect(rows[0]!.morning?.outlook?.verdict).toBe('clear');
    expect(rows[1]!.evening?.outlook?.verdict).toBe('clouded');
    // No frames for the third day: the windows exist, the outlook is null.
    expect(rows[2]!.evening).not.toBeNull();
    expect(rows[2]!.evening?.outlook).toBeNull();
    // The full Moon of 31 May is up at midnight and almost fully lit; a week later it is waning.
    expect(rows[0]!.moon.illuminatedFraction).toBeGreaterThan(0.95);
    expect(rows[0]!.moon.upAtMidnight).toBe(true);
    expect(rows[6]!.moon.illuminatedFraction).toBeLessThan(rows[0]!.moon.illuminatedFraction);
    // The windows are the day's own golden hours (Kailua: 18:3x–19:2x HST = 04:3x–05:2x UTC next day).
    expect(rows[0]!.evening!.start.toISOString()).toMatch(/^2026-06-01T04:3\d/);
  });

  it('labels a cell with the verdict and cloud, or says why there is none', () => {
    expect(
      weekAheadCellLabel(
        { verdict: 'high-colour', meanCloudCover: 72.4 },
        { inForecast: true, loading: false },
      ),
    ).toBe('high cloud — colour (72 %)');
    expect(weekAheadCellLabel(null, { inForecast: false, loading: true })).toBe(
      'beyond the forecast',
    );
    expect(weekAheadCellLabel(null, { inForecast: true, loading: true })).toBe('loading…');
    expect(weekAheadCellLabel(null, { inForecast: true, loading: false })).toBe('no forecast');
  });

  it('marks the nights with a Milky Way window: none around the full Moon, every night at new Moon', () => {
    // Full Moon 31 May 2026: the first dark window is the evening of 3 June (the same as the
    // dark windows list), so from 29 May only the last nights of the week qualify; new Moon
    // 15 June: every night.
    const fullWeek = darkNights(kailua, tz, { year: 2026, month: 5, day: 29 });
    expect(fullWeek.has('2026-05-31')).toBe(false);
    expect(fullWeek.has('2026-06-03')).toBe(true);
    expect(fullWeek.size).toBe(2);
    const dark = darkNights(kailua, tz, { year: 2026, month: 6, day: 12 });
    expect(dark.size).toBeGreaterThanOrEqual(6);
    expect(dark.has('2026-06-15')).toBe(true);
    const rows = weekAheadRows(kailua, tz, { year: 2026, month: 6, day: 12 }, new Map(), dark);
    expect(rows.filter((r) => r.darkSky).length).toBe(dark.size);
    // Each dark night carries its window (start before end, in the evening or after midnight),
    // and with that day's frames the forecast over it.
    const w = dark.get('2026-06-15')!;
    expect(w.end.getTime()).toBeGreaterThan(w.start.getTime());
    expect(rows.every((r) => r.darkOutlook === null)).toBe(true);
    const withFrames = weekAheadRows(
      kailua,
      tz,
      { year: 2026, month: 6, day: 12 },
      new Map([['2026-06-15', day('2026-06-15', 10)]]),
      dark,
    );
    expect(withFrames.find((r) => r.date === '2026-06-15')!.darkOutlook?.verdict).toBe('clear');
    expect(
      weekAheadRows(kailua, tz, { year: 2026, month: 6, day: 12 }, new Map()).every(
        (r) => !r.darkSky,
      ),
    ).toBe(true);
  });

  it('renders the week as text, one line per day', () => {
    const frames = new Map<string, WeatherFrame[]>([['2026-05-31', day('2026-05-31', 5)]]);
    const rows = weekAheadRows(kailua, tz, { year: 2026, month: 5, day: 31 }, frames);
    const text = weekAheadText(rows, tz, new Set(['2026-05-31', '2026-06-01']), 'Kailua Beach');
    const lines = text.split('\n');
    expect(lines[0]).toBe('The week ahead at Kailua Beach (times Pacific/Honolulu)');
    expect(lines[1]).toMatch(
      /^Sun 2026-05-31: morning 0\d:\d\d clear \(5 %\) · evening 1\d:\d\d clear \(5 %\) · Moon (99|100) %$/,
    );
    expect(lines[2]).toMatch(
      /^Mon 2026-06-01: morning 0\d:\d\d no forecast · evening 1\d:\d\d no forecast · Moon \d+ %/,
    );
    expect(lines[3]).toContain('beyond the forecast');
    expect(lines).toHaveLength(9);
  });
});

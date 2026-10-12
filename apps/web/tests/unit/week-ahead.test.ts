import { describe, expect, it } from 'vitest';
import type { WeatherFrame } from '@lightmap/weather';
import {
  weekAheadCellLabel,
  weekAheadDates,
  weekAheadRows,
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
});

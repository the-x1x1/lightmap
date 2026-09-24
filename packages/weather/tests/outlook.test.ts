import { describe, expect, it } from 'vitest';
import type { WeatherFrame } from '../src/model.ts';
import { brightWindows, hourlyOutlook } from '../src/outlook.ts';

function frame(hourUtc: number, cloud: number, over: Partial<WeatherFrame> = {}): WeatherFrame {
  return {
    timestamp: new Date(Date.UTC(2026, 4, 31, hourUtc)).toISOString(),
    cloudCoverTotal: cloud,
    cloudCoverLow: null,
    cloudCoverMid: null,
    cloudCoverHigh: null,
    precipitationProbability: 5,
    precipitationAmount: 0,
    humidity: 60,
    visibility: 30_000,
    windSpeed: 3,
    windDirection: 90,
    weatherCode: 1,
    ...over,
  };
}

// Honolulu: local hour h starts at UTC h + 10 (no DST).
const hst = (h: number) => new Date(Date.UTC(2026, 4, 31, h + 10));

describe('hourlyOutlook', () => {
  it('is empty on a scenario day (no frames): nothing is invented', () => {
    expect(hourlyOutlook([], hst)).toEqual([]);
  });

  it('yields one row per covered local hour with the scenario class and direct-light share', () => {
    // Frames cover UTC 10..33 (= local 00..23), clear until noon, overcast after, rain at 17.
    const frames: WeatherFrame[] = [];
    for (let u = 10; u <= 34; u++) {
      const local = u - 10;
      frames.push(
        frame(
          u,
          local < 12 ? 5 : 95,
          local === 17 ? { precipitationAmount: 2, weatherCode: 63 } : {},
        ),
      );
    }
    const rows = hourlyOutlook(frames, hst);
    expect(rows).toHaveLength(24);
    expect(rows[0]).toMatchObject({ hour: 0, scenario: 'clear' });
    expect(rows[0]!.directLightShare).toBeGreaterThan(0.9);
    expect(rows[14]).toMatchObject({ hour: 14, scenario: 'overcast' });
    expect(rows[14]!.directLightShare).toBeLessThan(0.3);
    expect(rows[17]!.scenario).toBe('storm');
    // Start of the local hour, in UTC (where the frame is valid).
    expect(rows[6]!.timestampUtc).toBe('2026-05-31T16:00:00.000Z');
  });

  it('skips hours the provider did not cover instead of extrapolating', () => {
    const frames = [frame(16, 10), frame(17, 10), frame(18, 10)]; // local 06..08 only
    const rows = hourlyOutlook(frames, hst);
    expect(rows.map((r) => r.hour)).toEqual([6, 7, 8]);
  });

  it('a spring-forward gap (02:00 → 03:00) does not produce a duplicate row', () => {
    const frames = Array.from({ length: 30 }, (_, i) => frame(i, 20));
    // hourStart shifts the missing 02:00 forward to the same instant as 03:00.
    const rows = hourlyOutlook(frames, (h) => new Date(Date.UTC(2026, 4, 31, h === 2 ? 3 : h)));
    expect(rows.map((r) => r.hour)).not.toContain(2);
    expect(rows.map((r) => r.hour)).toContain(3);
    expect(rows.filter((r) => r.timestampUtc === '2026-05-31T03:00:00.000Z')).toHaveLength(1);
  });

  it('honours a 23- or 25-hour civil day through hourStart', () => {
    const frames = Array.from({ length: 30 }, (_, i) => frame(i, 20));
    const rows = hourlyOutlook(
      frames,
      (h) => (h < 23 ? new Date(Date.UTC(2026, 4, 31, h)) : null),
      25,
    );
    expect(rows).toHaveLength(23);
  });
});

describe('brightWindows', () => {
  it('finds contiguous runs of usable direct light', () => {
    const frames: WeatherFrame[] = [];
    for (let u = 10; u <= 34; u++) {
      const local = u - 10;
      const cloud = local >= 7 && local <= 10 ? 5 : local >= 15 && local <= 16 ? 30 : 95;
      frames.push(frame(u, cloud));
    }
    const runs = brightWindows(hourlyOutlook(frames, hst));
    expect(runs.map((r) => [r.fromHour, r.toHour])).toEqual([
      [7, 10],
      [15, 16],
    ]);
    expect(runs[0]!.meanDirect).toBeGreaterThan(runs[1]!.meanDirect);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildMonthlyClimatology,
  climatologyCacheKey,
  daylightPattern,
  suggestedScenario,
  summarizeClimatology,
  type ClimatologyHour,
  type ClimatologyProvider,
} from '../src/climatology.ts';
import { FixtureClimatologyProvider } from '../src/providers/fixture-climatology.ts';
import { normalizeArchive } from '../src/providers/open-meteo-climatology.ts';

const meta = {
  providerId: 'test',
  latitude: 21.4,
  longitude: -157.7,
  month: 5,
  timeZone: 'Pacific/Honolulu',
  years: { from: 2020, to: 2021 },
  attribution: 'test',
  license: 'test',
};

function hoursFor(
  year: number,
  cloud: (h: number, d: number) => number,
  rain = 0,
): ClimatologyHour[] {
  const out: ClimatologyHour[] = [];
  for (let d = 1; d <= 31; d++)
    for (let h = 0; h < 24; h++)
      out.push({
        timestamp: new Date(Date.UTC(year, 4, d, h)).toISOString(),
        cloudCoverTotal: cloud(h, d),
        precipitationAmount: rain,
      });
  return out;
}

describe('summarizeClimatology', () => {
  it('keeps only the local daylight window and classifies with the scenario thresholds', () => {
    // UTC hour 16 = 06:00 HST; UTC 05 = 19:00 HST. Cloud: 0 % in the daylight window, 100 % at night.
    const hours = hoursFor(2020, (hUtc) => {
      const local = (hUtc - 10 + 24) % 24;
      return local >= 6 && local < 20 ? 5 : 100;
    });
    const s = summarizeClimatology(hours, meta);
    expect(s.sampleHours).toBe(31 * 14);
    expect(s.scenarioShare.clear).toBeCloseTo(1, 5);
    expect(s.scenarioShare.overcast).toBe(0);
    expect(s.meanCloudCover).toBeCloseTo(5, 5);
    expect(s.label).toBe('Typical for this month');
    expect(s.kind).toBe('CLIMATOLOGY');
  });

  it('shares sum to one and rain hours become the storm class', () => {
    const dry = hoursFor(2020, (_, d) => (d % 2 ? 30 : 90));
    const wet = hoursFor(2021, () => 60, 1.2);
    const s = summarizeClimatology([...dry, ...wet], meta);
    const total = Object.values(s.scenarioShare).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(s.scenarioShare.storm).toBeCloseTo(0.5, 2);
    expect(s.scenarioShare['mostly-clear']).toBeGreaterThan(0.2);
    expect(s.scenarioShare.overcast).toBeGreaterThan(0.2);
    expect(s.wetHourShare).toBeCloseTo(0.5, 2);
    expect(s.wetDayShare).toBeCloseTo(0.5, 2); // every 2021 day is wet, no 2020 day is
    expect(s.years).toEqual({ from: 2020, to: 2021, count: 2 });
  });

  it('suggests the largest class and never a forecast label', () => {
    const s = summarizeClimatology(
      hoursFor(2020, () => 95),
      meta,
    );
    expect(suggestedScenario(s)).toBe('overcast');
    expect(JSON.stringify(s).toLowerCase()).not.toContain('forecast');
  });

  it('breaks the month down by local hour of day, over the whole day, and names the pattern', () => {
    // Trade-wind mornings: clear until 10:00 HST, building to overcast by mid-afternoon, then
    // clearing again after sunset. Local hour = (UTC − 10) mod 24.
    const cloudAt = (local: number) =>
      local < 10 ? 10 : local < 13 ? 45 : local < 17 ? 90 : local < 20 ? 60 : 20;
    const hours = hoursFor(2020, (hUtc) => cloudAt((hUtc - 10 + 24) % 24));
    const s = summarizeClimatology(hours, meta);
    expect(s.byHour).toHaveLength(24);
    for (const b of s.byHour) expect(b.samples).toBe(31);
    expect(s.byHour[8]!.meanCloudCover).toBeCloseTo(10, 5);
    expect(s.byHour[8]!.clearShare).toBeCloseTo(1, 5);
    expect(s.byHour[15]!.meanCloudCover).toBeCloseTo(90, 5);
    expect(s.byHour[15]!.dullShare).toBeCloseTo(1, 5);
    expect(s.byHour[22]!.meanCloudCover).toBeCloseTo(20, 5); // night hours are kept here …
    expect(s.sampleHours).toBe(31 * 14); // … but not in the headline window
    const p = daylightPattern(s);
    expect(p).not.toBeNull();
    expect(p!.clearest.from).toBeGreaterThanOrEqual(6);
    expect(p!.clearest.to).toBeLessThanOrEqual(10);
    expect(p!.dullest.from).toBeGreaterThanOrEqual(13);
    expect(p!.dullest.to).toBeLessThanOrEqual(17);
  });

  it('reports no daily pattern when the spread is small', () => {
    const s = summarizeClimatology(
      hoursFor(2020, (h) => 50 + (h % 2) * 4),
      meta,
    );
    expect(daylightPattern(s)).toBeNull();
    // Hours without samples are zero, never NaN.
    const sparse = summarizeClimatology([], meta);
    expect(sparse.byHour.every((b) => b.samples === 0 && b.meanCloudCover === 0)).toBe(true);
    expect(daylightPattern(sparse)).toBeNull();
  });

  it('cache key uses a 0.5° cell so nearby pins share one summary', () => {
    const a = climatologyCacheKey('p', 21.41, -157.72, 5, { from: 2015, to: 2024 });
    const b = climatologyCacheKey('p', 21.38, -157.68, 5, { from: 2015, to: 2024 });
    expect(a).toBe(b);
    expect(a).toBe('v2:p:21.5,-157.5:m5:2015-2024:h6-20:UTC');
    expect(
      climatologyCacheKey(
        'p',
        21.41,
        -157.72,
        5,
        { from: 2015, to: 2024 },
        undefined,
        'Pacific/Honolulu',
      ),
    ).not.toBe(a);
  });
});

describe('buildMonthlyClimatology', () => {
  it('fetches one month per year with bounded concurrency and summarises', async () => {
    const calls: Array<[number, number]> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const provider: ClimatologyProvider = {
      getCapabilities: () => ({
        providerId: 'stub',
        earliestYear: 2010,
        defaultYears: 4,
        isFixture: true,
        attribution: 'stub',
        license: 'stub',
        commercialReview: 'blocked',
      }),
      async getMonthHours(_lat, _lng, year, month) {
        calls.push([year, month]);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return hoursFor(year, () => 50);
      },
    };
    const s = await buildMonthlyClimatology(provider, {
      latitude: 21.4,
      longitude: -157.7,
      month: 5,
      timeZone: 'Pacific/Honolulu',
      toYear: 2024,
      concurrency: 2,
    });
    expect(calls.map((c) => c[0]).sort()).toEqual([2021, 2022, 2023, 2024]);
    expect(calls.every((c) => c[1] === 5)).toBe(true);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(s.years).toEqual({ from: 2021, to: 2024, count: 4 });
    expect(s.scenarioShare['partly-cloudy']).toBeCloseTo(1, 5);
  });

  it('the fixture provider is deterministic and cloudier toward the poles', async () => {
    const p = new FixtureClimatologyProvider();
    const a = await p.getMonthHours(21.4, -157.7, 2020, 5);
    const b = await p.getMonthHours(21.4, -157.7, 2020, 5);
    expect(a).toEqual(b);
    expect(a).toHaveLength(31 * 24);
    const tropics = summarizeClimatology(a, meta);
    const polar = summarizeClimatology(await p.getMonthHours(69.6, 18.9, 2020, 5), {
      ...meta,
      latitude: 69.6,
      longitude: 18.9,
      timeZone: 'Europe/Oslo',
    });
    expect(polar.meanCloudCover).toBeGreaterThan(tropics.meanCloudCover);
  });
});

describe('normalizeArchive', () => {
  it('maps the Open-Meteo archive schema and drops rows without cloud cover', () => {
    const rows = normalizeArchive({
      hourly: {
        time: ['2020-05-01T00:00', '2020-05-01T01:00', '2020-05-01T02:00'],
        cloud_cover: [12, null, 88],
        precipitation: [0, 0.2, null],
      },
    });
    expect(rows).toEqual([
      { timestamp: '2020-05-01T00:00:00.000Z', cloudCoverTotal: 12, precipitationAmount: 0 },
      { timestamp: '2020-05-01T02:00:00.000Z', cloudCoverTotal: 88, precipitationAmount: null },
    ]);
  });
});

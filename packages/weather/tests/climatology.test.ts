import { describe, expect, it } from 'vitest';
import {
  buildMonthlyClimatology,
  climatologyCacheKey,
  daylightPattern,
  hoursBetween,
  hoursShare,
  suggestedScenario,
  humidityByHour,
  temperatureByHour,
  windByHour,
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

  it('aggregates a set of local hours — the dark hours wrap midnight', () => {
    // Clear mornings (hours 6–10 at 10 % cloud), dull afternoons (13–17 at 90 %), 20 % at night.
    const cloudAt = (local: number) =>
      local < 10 ? 10 : local < 13 ? 45 : local < 17 ? 90 : local < 20 ? 60 : 20;
    const hours = hoursFor(2020, (hUtc) => cloudAt((hUtc - 10 + 24) % 24));
    const s = summarizeClimatology(hours, meta);
    expect(hoursBetween(21, 4)).toEqual([21, 22, 23, 0, 1, 2, 3]);
    expect(hoursBetween(4, 4)).toEqual([]);
    expect(hoursBetween(23, 1)).toEqual([23, 0]);
    const night = hoursShare(s, hoursBetween(21, 4))!;
    expect(night.samples).toBe(31 * 7);
    // 21–23 h at 20 %, 0–3 h at 10 %: (3 × 20 + 4 × 10) / 7.
    expect(night.meanCloudCover).toBeCloseTo(100 / 7, 5);
    expect(night.clearShare).toBeCloseTo(1, 5);
    const morning = hoursShare(s, [6, 7, 8, 9]);
    expect(morning!.meanCloudCover).toBeCloseTo(10, 5);
    // Duplicates and aliases count once; fractions floor; an empty set or hours without samples
    // give null; a non-finite bound yields no hours.
    expect(hoursShare(s, [22, 22])!.samples).toBe(31);
    expect(hoursShare(s, [-1, 23, 47, 23.5])!.samples).toBe(31);
    expect(hoursBetween(Number.NaN, 3)).toEqual([]);
    expect(hoursBetween(2, Number.POSITIVE_INFINITY)).toEqual([]);
    expect(hoursShare(s, [])).toBeNull();
    expect(hoursShare(summarizeClimatology([], meta), [1, 2])).toBeNull();
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
    expect(a).toBe('v5:p:21.5,-157.5:m5:2015-2024:h6-20:UTC');
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

  it('the fixture air runs on local time and has the seasons the right way round', async () => {
    const p = new FixtureClimatologyProvider();
    const mean = (rows: Awaited<ReturnType<typeof p.getMonthHours>>) =>
      rows.reduce((acc, r) => acc + (r.temperature ?? 0), 0) / rows.length;
    // Tromsø: July warmer than January; Sydney the other way round; the tropics warmer than both.
    const tromsoJul = mean(await p.getMonthHours(69.6, 18.9, 2020, 7));
    const tromsoJan = mean(await p.getMonthHours(69.6, 18.9, 2020, 1));
    expect(tromsoJul).toBeGreaterThan(tromsoJan + 10);
    expect(mean(await p.getMonthHours(-33.9, 151.2, 2020, 1))).toBeGreaterThan(
      mean(await p.getMonthHours(-33.9, 151.2, 2020, 7)),
    );
    expect(mean(await p.getMonthHours(21.4, -157.7, 2020, 1))).toBeGreaterThan(tromsoJan + 20);
    // Warmest in the place's afternoon, not UTC's: Honolulu's hottest hour lands at 14–16 local.
    const s = summarizeClimatology(await p.getMonthHours(21.4, -157.7, 2020, 5), meta);
    const t = temperatureByHour(s.byHour, 12)!;
    expect(t.warmestHour).toBeGreaterThanOrEqual(14);
    expect(t.warmestHour).toBeLessThanOrEqual(16);
    expect(t.coldestHour).toBeGreaterThanOrEqual(2);
    expect(t.coldestHour).toBeLessThanOrEqual(4);
    const h = humidityByHour(s.byHour, 12)!;
    expect(h.peakHour).toBeGreaterThanOrEqual(3);
    expect(h.peakHour).toBeLessThanOrEqual(7);
  });
});

describe('normalizeArchive', () => {
  it('maps the Open-Meteo archive schema and drops rows without cloud cover', () => {
    const rows = normalizeArchive({
      hourly: {
        time: ['2020-05-01T00:00', '2020-05-01T01:00', '2020-05-01T02:00'],
        cloud_cover: [12, null, 88],
        precipitation: [0, 0.2, null],
        relative_humidity_2m: [96, 80, null],
        temperature_2m: [24.5, 23, null],
        wind_speed_10m: [3.2, 4, -1],
      },
    });
    expect(rows).toEqual([
      {
        timestamp: '2020-05-01T00:00:00.000Z',
        cloudCoverTotal: 12,
        precipitationAmount: 0,
        humidity: 96,
        temperature: 24.5,
        windSpeed: 3.2,
      },
      {
        timestamp: '2020-05-01T02:00:00.000Z',
        cloudCoverTotal: 88,
        precipitationAmount: null,
        humidity: null,
        temperature: null,
        windSpeed: 0,
      },
    ]);
  });
});

describe('humidity by hour of day (dew and mist climatology)', () => {
  it('counts the hours at or over 95 % among those with a known humidity, per local hour', () => {
    // Honolulu (UTC−10): local 05:00 is 15:00 UTC; four mornings, three of them saturated.
    const hours = [96, 99, 95, 80].map((rh, d) => ({
      timestamp: new Date(Date.UTC(2020, 4, d + 1, 15)).toISOString(),
      cloudCoverTotal: 20,
      precipitationAmount: 0,
      humidity: rh,
    }));
    // A fifth morning without humidity counts toward cloud but not toward the humid share.
    hours.push({
      timestamp: new Date(Date.UTC(2020, 4, 5, 15)).toISOString(),
      cloudCoverTotal: 20,
      precipitationAmount: 0,
      humidity: null as unknown as number,
    });
    const s = summarizeClimatology(hours, {
      providerId: 'p',
      latitude: 21.4,
      longitude: -157.7,
      month: 5,
      timeZone: 'Pacific/Honolulu',
      years: { from: 2020, to: 2020 },
      attribution: '',
      license: '',
    });
    const five = s.byHour[5]!;
    expect(five.samples).toBe(5);
    expect(five.humiditySamples).toBe(4);
    expect(five.humidShare).toBeCloseTo(0.75, 9);
    expect(s.byHour[12]).toMatchObject({ humiditySamples: 0, humidShare: 0 });
    // No temperature in these rows: counted as none, mean 0.
    expect(five).toMatchObject({ temperatureSamples: 0, meanTemperature: 0 });
  });
});

describe('temperature by hour of day (typical air)', () => {
  it('averages the known temperatures per local hour and ignores the unknown ones', () => {
    // Honolulu: local 05:00 is 15:00 UTC, local 14:00 is 00:00 UTC the next day.
    const hours = [
      ...[18, 19, 20, null].map((t, d) => ({
        timestamp: new Date(Date.UTC(2020, 4, d + 1, 15)).toISOString(),
        cloudCoverTotal: 20,
        precipitationAmount: 0,
        temperature: t,
      })),
      ...[27.5, 28.5].map((t, d) => ({
        timestamp: new Date(Date.UTC(2020, 4, d + 2, 0)).toISOString(),
        cloudCoverTotal: 40,
        precipitationAmount: 0,
        temperature: t,
      })),
    ];
    const s = summarizeClimatology(hours, {
      providerId: 'p',
      latitude: 21.4,
      longitude: -157.7,
      month: 5,
      timeZone: 'Pacific/Honolulu',
      years: { from: 2020, to: 2020 },
      attribution: '',
      license: '',
    });
    expect(s.byHour[5]).toMatchObject({ samples: 4, temperatureSamples: 3, meanTemperature: 19 });
    expect(s.byHour[14]).toMatchObject({ samples: 2, temperatureSamples: 2, meanTemperature: 28 });
    expect(temperatureByHour(s.byHour, 5)).toEqual({
      atHour: 19,
      coldestHour: 5,
      coldest: 19,
      warmestHour: 14,
      warmest: 28,
    });
    expect(temperatureByHour(s.byHour, 9)?.atHour).toBeNull();
    expect(temperatureByHour(s.byHour, 29)?.atHour).toBe(19); // hours wrap
  });

  it('wind by hour: the mean, the fresh-breeze share and the calmest and windiest hours', () => {
    const hours = [
      ...[2, 3, null, 4].map((w, d) => ({
        timestamp: new Date(Date.UTC(2020, 4, d + 1, 15)).toISOString(), // 05:00 HST
        cloudCoverTotal: 20,
        precipitationAmount: 0,
        windSpeed: w,
      })),
      ...[6, 9, 12].map((w, d) => ({
        timestamp: new Date(Date.UTC(2020, 4, d + 2, 0)).toISOString(), // 14:00 HST
        cloudCoverTotal: 40,
        precipitationAmount: 0,
        windSpeed: w,
      })),
    ];
    const s = summarizeClimatology(hours, {
      providerId: 'p',
      latitude: 21.4,
      longitude: -157.7,
      month: 5,
      timeZone: 'Pacific/Honolulu',
      years: { from: 2020, to: 2020 },
      attribution: '',
      license: '',
    });
    expect(s.byHour[5]).toMatchObject({ windSamples: 3, meanWindSpeed: 3, windyShare: 0 });
    expect(s.byHour[14]).toMatchObject({ windSamples: 3, meanWindSpeed: 9 });
    expect(s.byHour[14]!.windyShare).toBeCloseTo(2 / 3, 9);
    expect(windByHour(s.byHour, 14)).toMatchObject({
      calmestHour: 5,
      calmest: 3,
      windiestHour: 14,
      windiest: 9,
    });
    expect(windByHour(s.byHour, 14)!.windiestShare).toBeCloseTo(2 / 3, 9);
    expect(windByHour(s.byHour, 14)!.atHour?.meanWindSpeed).toBe(9);
    expect(windByHour(s.byHour, 9)?.atHour).toBeNull();
    expect(windByHour([{ hour: 1 }], 1)).toBeNull();
  });

  it('says nothing when no temperature was ever known (older cached summaries)', () => {
    expect(temperatureByHour([{ hour: 5 }, { hour: 6, temperatureSamples: 0 }], 5)).toBeNull();
    expect(temperatureByHour([], 5)).toBeNull();
  });
});

describe('humidityByHour', () => {
  const row = (hour: number, humiditySamples: number, humidShare: number) => ({
    hour,
    humiditySamples,
    humidShare,
  });
  it('names the hour where saturated air is most common and the share at the selected hour', () => {
    const byHour = [row(4, 30, 0.5), row(5, 30, 0.62), row(12, 30, 0.08), row(13, 0, 0)];
    expect(humidityByHour(byHour, 12)).toEqual({ atHour: 0.08, peakHour: 5, peakShare: 0.62 });
    expect(humidityByHour(byHour, 13)?.atHour).toBeNull(); // no humidity known at 13:00
    expect(humidityByHour(byHour, 29)?.atHour).toBe(0.62); // hours wrap
  });
  it('says nothing when no humidity was ever known (older cached summaries)', () => {
    expect(humidityByHour([{ hour: 5 }, { hour: 6 }], 5)).toBeNull();
    expect(humidityByHour([], 5)).toBeNull();
  });
});

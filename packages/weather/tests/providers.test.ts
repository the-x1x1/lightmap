import { describe, expect, it } from 'vitest';
import { parseEnv } from '@lightmap/config';
import { describeWeatherCode, interpolateFrame, weatherFamily } from '../src/model.ts';
import { FixtureWeatherProvider } from '../src/providers/fixture.ts';
import {
  OPEN_METEO_CAPABILITIES,
  OpenMeteoProvider,
  normalizeOpenMeteo,
} from '../src/providers/open-meteo.ts';
import { createWeatherProvider } from '../src/registry.ts';

const urlOf = (u: string | URL | Request): string =>
  typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;

const sample = {
  latitude: 21.4,
  longitude: -157.75,
  elevation: 3,
  timezone: 'GMT',
  hourly: {
    time: ['2026-05-31T00:00', '2026-05-31T01:00', '2026-05-31T02:00'],
    cloud_cover: [10, 50, null],
    cloud_cover_low: [5, 30, 60],
    cloud_cover_mid: [3, 10, 10],
    cloud_cover_high: [2, 10, 10],
    precipitation_probability: [0, 20, 40],
    precipitation: [0, 0.1, 1],
    relative_humidity_2m: [70, 75, 80],
    visibility: [40000, 20000, 10000],
    wind_speed_10m: [3, 4, 5],
    wind_direction_10m: [350, 10, 20],
    weather_code: [0, 2, 61],
    direct_normal_irradiance: [0, 0, 0],
    diffuse_radiation: [0, 0, 0],
    shortwave_radiation: [0, 0, 0],
    temperature_2m: [24.1, 23.5, 23],
    dew_point_2m: [18.2, 18.6, 19],
    apparent_temperature: [26, 25.5, 25],
    snow_depth: [0, 0.02, 0.05],
  },
};

describe('Open-Meteo normalisation', () => {
  it('maps hourly arrays to frames and drops frames without cloud cover', () => {
    const s = normalizeOpenMeteo(
      sample,
      21.397,
      -157.727,
      new Date('2026-05-30T12:00:00Z'),
      OPEN_METEO_CAPABILITIES,
    );
    expect(s.frames).toHaveLength(2);
    expect(s.frames[0]).toMatchObject({
      timestamp: '2026-05-31T00:00:00.000Z',
      cloudCoverTotal: 10,
      cloudCoverLow: 5,
      windDirection: 350,
      weatherCode: 0,
      visibility: 40000,
      temperature: 24.1,
      dewPoint: 18.2,
      snowDepth: 0,
      apparentTemperature: 26,
    });
    expect(s.latitude).toBe(21.4);
    expect(s.modelElevationM).toBe(3);
    expect(s.timeZone).toBeNull();
    expect(s.capabilities.attribution).toContain('Open-Meteo');
  });

  it('interpolates frames, including wind direction across north', () => {
    const s = normalizeOpenMeteo(sample, 21.4, -157.75, new Date(), OPEN_METEO_CAPABILITIES);
    const mid = interpolateFrame(s.frames, new Date('2026-05-31T00:30:00Z'))!;
    expect(mid.cloudCoverTotal).toBe(30);
    expect(mid.windDirection).toBeCloseTo(0, 5);
    expect(mid.weatherCode).toBe(2);
    expect(mid.temperature).toBeCloseTo(23.8, 6);
    expect(mid.dewPoint).toBeCloseTo(18.4, 6);
    expect(mid.apparentTemperature).toBeCloseTo(25.75, 6);
    // A frame pair without the air fields interpolates to null, not NaN.
    const bare = s.frames.map(({ dewPoint: _absent, ...f }) => ({ ...f, temperature: null }));
    const midBare = interpolateFrame(bare, new Date('2026-05-31T00:30:00Z'))!;
    expect(midBare.temperature).toBeNull();
    expect(midBare.dewPoint).toBeNull();
    expect(interpolateFrame(s.frames, new Date('2026-05-30T00:00:00Z'))?.cloudCoverTotal).toBe(10);
    expect(interpolateFrame([], new Date())).toBeNull();
  });

  it('requests the right fields with the customer endpoint when a key exists', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push(urlOf(url));
      return new Response(JSON.stringify(sample), { status: 200 });
    }) as typeof fetch;
    const p = new OpenMeteoProvider({ apiKey: 'k', fetchImpl });
    await p.getForecast(
      21.397,
      -157.727,
      new Date('2026-05-31T00:00:00Z'),
      new Date('2026-05-31T23:00:00Z'),
    );
    expect(seen[0]).toContain('customer-api.open-meteo.com');
    expect(seen[0]).toContain('apikey=k');
    expect(seen[0]).toContain('cloud_cover_low');
    expect(seen[0]).toContain('temperature_2m');
    expect(seen[0]).toContain('dew_point_2m');
    expect(seen[0]).toContain('apparent_temperature');
    expect(seen[0]).toContain('snow_depth');
    expect(seen[0]).toContain('timezone=UTC');
    expect(p.getCapabilities().commercialReview).toBe('approved');
    expect(new OpenMeteoProvider().getCapabilities().commercialReview).toBe('conditional');
  });

  it('never asks the forecast endpoint for a day past its sixteenth (today included)', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push(urlOf(url));
      return new Response(JSON.stringify(sample), { status: 200 });
    }) as typeof fetch;
    const now = () => new Date('2026-05-31T20:00:00Z');
    const p = new OpenMeteoProvider({ fetchImpl, now });
    // Kailua's civil day 15 days ahead (15 June HST) ends at 09:59 UTC on 16 June: cut to 15 June.
    await p.getForecast(
      21.397,
      -157.727,
      new Date('2026-06-15T10:00:00Z'),
      new Date('2026-06-16T09:59:00Z'),
    );
    expect(seen[0]).toContain('start_date=2026-06-15');
    expect(seen[0]).toContain('end_date=2026-06-15');
    // A day well inside the horizon is requested as asked.
    await p.getForecast(
      21.397,
      -157.727,
      new Date('2026-06-02T10:00:00Z'),
      new Date('2026-06-03T09:59:00Z'),
    );
    expect(seen[1]).toContain('end_date=2026-06-03');
    // The declared horizon matches: 15 days of lead at most.
    expect(p.getCapabilities().maxHorizonHours).toBe(15 * 24);
  });

  it('serves history beyond 92 days from the reanalysis archive without the fields it lacks', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push(urlOf(url));
      return new Response(JSON.stringify(sample), { status: 200 });
    }) as typeof fetch;
    const now = () => new Date('2026-05-31T00:00:00Z');
    const p = new OpenMeteoProvider({ fetchImpl, now });
    await p.getHistorical(
      21.397,
      -157.727,
      new Date('2026-05-20T00:00:00Z'),
      new Date('2026-05-20T23:00:00Z'),
    );
    expect(seen[0]).toContain('api.open-meteo.com/v1/forecast');
    const series = await p.getHistorical(
      21.397,
      -157.727,
      new Date('2024-05-31T00:00:00Z'),
      new Date('2024-05-31T23:00:00Z'),
    );
    expect(seen[1]).toContain('archive-api.open-meteo.com/v1/archive');
    expect(seen[1]).toContain('cloud_cover_low');
    expect(seen[1]).not.toContain('visibility');
    expect(seen[1]).not.toContain('precipitation_probability');
    expect(seen[1]).toContain('start_date=2024-05-31');
    expect(series.frames.length).toBeGreaterThan(0);
    const keyed = new OpenMeteoProvider({ apiKey: 'k', fetchImpl, now });
    await keyed.getHistorical(
      0,
      0,
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T23:00:00Z'),
    );
    expect(seen[2]).toContain('customer-archive-api.open-meteo.com');
    expect(seen[2]).toContain('apikey=k');
  });

  it('surfaces provider errors', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: true, reason: 'bad' }), {
        status: 200,
      })) as unknown as typeof fetch;
    await expect(
      new OpenMeteoProvider({ fetchImpl }).getForecast(0, 0, new Date(), new Date()),
    ).rejects.toThrow('bad');
    const fetch500 = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(
      new OpenMeteoProvider({ fetchImpl: fetch500 }).getForecast(0, 0, new Date(), new Date()),
    ).rejects.toThrow('500');
  });
});

describe('fixture provider', () => {
  it('is deterministic, labelled and hourly', async () => {
    const p = new FixtureWeatherProvider();
    const a = await p.getForecast(
      21.397,
      -157.727,
      new Date('2026-05-31T00:00:00Z'),
      new Date('2026-05-31T00:00:00Z'),
    );
    const b = await p.getForecast(
      21.397,
      -157.727,
      new Date('2026-05-31T00:00:00Z'),
      new Date('2026-05-31T00:00:00Z'),
    );
    expect(a.frames).toHaveLength(24);
    expect(a.frames.map((f) => f.cloudCoverTotal)).toEqual(b.frames.map((f) => f.cloudCoverTotal));
    expect(a.capabilities.isFixture).toBe(true);
    expect(a.capabilities.attribution).toContain('not a forecast');
    const storm = await new FixtureWeatherProvider({ pattern: 'storm' }).getForecast(
      0,
      0,
      new Date(),
      new Date(),
    );
    expect(storm.frames[0]?.weatherCode).toBe(63);
  });

  it('carries an air temperature with a dew point at or below it, warmer at noon than at dawn', () => {
    const p = new FixtureWeatherProvider();
    // Kailua: 16:00 UTC is 06:00 HST, 01:00 UTC is 15:00 HST.
    const dawn = p.frameAt(new Date('2026-05-31T16:00:00Z'), 21.397, -157.727);
    const afternoon = p.frameAt(new Date('2026-05-31T01:00:00Z'), 21.397, -157.727);
    expect(dawn.temperature).toBeGreaterThan(10);
    expect(afternoon.temperature).toBeGreaterThan(dawn.temperature!);
    for (const f of [dawn, afternoon]) {
      expect(f.dewPoint).toBeLessThanOrEqual(f.temperature!);
      expect(f.dewPoint).toBeGreaterThan(f.temperature! - 12);
    }
    // Colder toward the poles.
    const tromso = p.frameAt(new Date('2026-05-31T01:00:00Z'), 69.65, 18.96);
    expect(tromso.temperature).toBeLessThan(dawn.temperature!);
  });
});

describe('registry and codes', () => {
  it('selects providers from env', () => {
    expect(
      createWeatherProvider(parseEnv({ WEATHER_PROVIDER: 'fixture' }).env).getCapabilities()
        .providerId,
    ).toBe('fixture');
    expect(createWeatherProvider(parseEnv({}).env).getCapabilities().providerId).toBe('open-meteo');
  });
  it('classifies WMO codes', () => {
    expect(weatherFamily(0)).toBe('clear');
    expect(weatherFamily(3)).toBe('cloudy');
    expect(weatherFamily(45)).toBe('fog');
    expect(weatherFamily(63)).toBe('rain');
    expect(weatherFamily(73)).toBe('snow');
    expect(weatherFamily(95)).toBe('thunderstorm');
    expect(weatherFamily(null)).toBe('unknown');
    expect(describeWeatherCode(2)).toBe('Partly cloudy');
    expect(describeWeatherCode(123)).toBe('Weather code 123');
  });
});

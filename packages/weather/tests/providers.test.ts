import { describe, expect, it } from 'vitest';
import { parseEnv } from '@lightmap/config';
import { describeWeatherCode, interpolateFrame, weatherFamily } from '../src/model.ts';
import { FixtureWeatherProvider } from '../src/providers/fixture.ts';
import { OPEN_METEO_CAPABILITIES, OpenMeteoProvider, normalizeOpenMeteo } from '../src/providers/open-meteo.ts';
import { createWeatherProvider } from '../src/registry.ts';

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
  },
};

describe('Open-Meteo normalisation', () => {
  it('maps hourly arrays to frames and drops frames without cloud cover', () => {
    const s = normalizeOpenMeteo(sample, 21.397, -157.727, new Date('2026-05-30T12:00:00Z'), OPEN_METEO_CAPABILITIES);
    expect(s.frames).toHaveLength(2);
    expect(s.frames[0]).toMatchObject({ timestamp: '2026-05-31T00:00:00.000Z', cloudCoverTotal: 10, cloudCoverLow: 5, windDirection: 350, weatherCode: 0, visibility: 40000 });
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
    expect(interpolateFrame(s.frames, new Date('2026-05-30T00:00:00Z'))?.cloudCoverTotal).toBe(10);
    expect(interpolateFrame([], new Date())).toBeNull();
  });

  it('requests the right fields with the customer endpoint when a key exists', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(JSON.stringify(sample), { status: 200 });
    }) as typeof fetch;
    const p = new OpenMeteoProvider({ apiKey: 'k', fetchImpl });
    await p.getForecast(21.397, -157.727, new Date('2026-05-31T00:00:00Z'), new Date('2026-05-31T23:00:00Z'));
    expect(seen[0]).toContain('customer-api.open-meteo.com');
    expect(seen[0]).toContain('apikey=k');
    expect(seen[0]).toContain('cloud_cover_low');
    expect(seen[0]).toContain('timezone=UTC');
    expect(p.getCapabilities().commercialReview).toBe('approved');
    expect(new OpenMeteoProvider().getCapabilities().commercialReview).toBe('conditional');
  });

  it('surfaces provider errors', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: true, reason: 'bad' }), { status: 200 })) as unknown as typeof fetch;
    await expect(new OpenMeteoProvider({ fetchImpl }).getForecast(0, 0, new Date(), new Date())).rejects.toThrow('bad');
    const fetch500 = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(new OpenMeteoProvider({ fetchImpl: fetch500 }).getForecast(0, 0, new Date(), new Date())).rejects.toThrow('500');
  });
});

describe('fixture provider', () => {
  it('is deterministic, labelled and hourly', async () => {
    const p = new FixtureWeatherProvider();
    const a = await p.getForecast(21.397, -157.727, new Date('2026-05-31T00:00:00Z'), new Date('2026-05-31T00:00:00Z'));
    const b = await p.getForecast(21.397, -157.727, new Date('2026-05-31T00:00:00Z'), new Date('2026-05-31T00:00:00Z'));
    expect(a.frames).toHaveLength(24);
    expect(a.frames.map((f) => f.cloudCoverTotal)).toEqual(b.frames.map((f) => f.cloudCoverTotal));
    expect(a.capabilities.isFixture).toBe(true);
    expect(a.capabilities.attribution).toContain('not a forecast');
    const storm = await new FixtureWeatherProvider({ pattern: 'storm' }).getForecast(0, 0, new Date(), new Date());
    expect(storm.frames[0]?.weatherCode).toBe(63);
  });
});

describe('registry and codes', () => {
  it('selects providers from env', () => {
    expect(createWeatherProvider(parseEnv({ WEATHER_PROVIDER: 'fixture' }).env).getCapabilities().providerId).toBe('fixture');
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

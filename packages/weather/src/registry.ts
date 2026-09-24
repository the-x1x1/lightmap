import type { Env } from '@lightmap/config';
import type { WeatherProvider } from './model.ts';
import { FixtureWeatherProvider } from './providers/fixture.ts';
import { OpenMeteoProvider } from './providers/open-meteo.ts';

/** Select the configured weather provider. Server-side only (the Open-Meteo key must not leak). */
export function createWeatherProvider(env: Env, opts: { fetchImpl?: typeof fetch; now?: () => Date } = {}): WeatherProvider {
  switch (env.WEATHER_PROVIDER) {
    case 'open-meteo':
      return new OpenMeteoProvider({
        baseUrl: env.OPEN_METEO_API_KEY ? 'https://customer-api.open-meteo.com' : env.OPEN_METEO_BASE_URL,
        ...(env.OPEN_METEO_API_KEY ? { apiKey: env.OPEN_METEO_API_KEY } : {}),
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      });
    case 'fixture':
      return new FixtureWeatherProvider(opts.now ? { now: opts.now } : {});
  }
}

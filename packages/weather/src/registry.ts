import type { Env } from '@lightmap/config';
import type { WeatherProvider } from './model.ts';
import type { ClimatologyProvider } from './climatology.ts';
import { FixtureWeatherProvider } from './providers/fixture.ts';
import { OpenMeteoProvider } from './providers/open-meteo.ts';
import { FixtureClimatologyProvider } from './providers/fixture-climatology.ts';
import { OpenMeteoClimatologyProvider } from './providers/open-meteo-climatology.ts';

/** Select the configured weather provider. Server-side only (the Open-Meteo key must not leak). */
export function createWeatherProvider(
  env: Env,
  opts: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): WeatherProvider {
  switch (env.WEATHER_PROVIDER) {
    case 'open-meteo':
      return new OpenMeteoProvider({
        baseUrl: env.OPEN_METEO_API_KEY
          ? 'https://customer-api.open-meteo.com'
          : env.OPEN_METEO_BASE_URL,
        ...(env.OPEN_METEO_API_KEY ? { apiKey: env.OPEN_METEO_API_KEY } : {}),
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      });
    case 'fixture':
      return new FixtureWeatherProvider(opts.now ? { now: opts.now } : {});
  }
}

/**
 * Climatology follows the weather provider choice: Open-Meteo's archive when Open-Meteo is the
 * forecast source (same key, same commercial terms), the fixture otherwise. Server-side only.
 */
export function createClimatologyProvider(
  env: Env,
  opts: { fetchImpl?: typeof fetch } = {},
): ClimatologyProvider {
  switch (env.WEATHER_PROVIDER) {
    case 'open-meteo':
      return new OpenMeteoClimatologyProvider({
        ...(env.OPEN_METEO_API_KEY ? { apiKey: env.OPEN_METEO_API_KEY } : {}),
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
    case 'fixture':
      return new FixtureClimatologyProvider();
  }
}

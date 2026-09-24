/**
 * Server-side service container: providers, db, billing, logger — built once per process from the
 * validated env. API routes import from here and never touch vendor SDKs directly (plan §12).
 */
import 'server-only';
import { envCapabilities, featureFlags, getEnv, type Env } from '@lightmap/config';
import { createGeospatialProviders, type GeospatialProviders, type TimezoneProvider } from '@lightmap/geospatial';
import { createWeatherProvider, type WeatherProvider } from '@lightmap/weather';
import { createDb, type DbHandle } from '@lightmap/database';
import { createBillingProvider, type BillingProvider } from '@lightmap/billing/stripe';
import { createLogger, loggingErrorReporter, type ErrorReporter, type Logger } from '@lightmap/observability';
import { GeoTzTimezoneProvider } from './timezone.ts';
import { authMethods } from '@lightmap/auth/config';

export interface Services {
  env: Env;
  log: Logger;
  errors: ErrorReporter;
  geo: GeospatialProviders;
  weather: WeatherProvider;
  billing: BillingProvider;
  /** Null when DATABASE_URL is unset: anonymous exploration still works; saving does not. */
  db: DbHandle | null;
  capabilities: ReturnType<typeof envCapabilities>;
  flags: typeof featureFlags;
  authMethods: ReturnType<typeof authMethods>;
}

let services: Services | null = null;

export function getServices(): Services {
  if (services) return services;
  const { env, issues, ok } = getEnv();
  const log = createLogger({ level: env.LOG_LEVEL, bindings: { service: 'web' } });
  for (const i of issues) log[i.severity === 'error' ? 'error' : 'warn'](`env ${i.key}: ${i.message}`);
  if (!ok && env.NODE_ENV === 'production') throw new Error('Refusing to start with invalid production environment (see log)');
  const timezone: TimezoneProvider = new GeoTzTimezoneProvider();
  const geo = createGeospatialProviders(env, { timezoneProvider: timezone });
  const weather = createWeatherProvider(env);
  const billing = createBillingProvider(env);
  const db = env.DATABASE_URL ? createDb(env.DATABASE_URL) : null;
  if (!db) log.warn('DATABASE_URL unset: accounts, projects and billing are disabled; map exploration works');
  services = { env, log, errors: loggingErrorReporter(log), geo, weather, billing, db, capabilities: envCapabilities(env), flags: featureFlags, authMethods: authMethods(env) };
  return services;
}

/** Test hook. */
export function resetServices(): void {
  services = null;
}

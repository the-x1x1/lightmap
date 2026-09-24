/**
 * Environment validation without a schema library: a hand-rolled, dependency-free parser so
 * `scripts/validate-env.ts` can run under plain Node before anything is installed, and so the
 * same rules run at boot inside Next.js server code.
 *
 * Rules (plan §29, §33):
 * - Secrets never reach the client: only `NEXT_PUBLIC_*` keys are considered public.
 * - Missing provider credentials do not crash the app; they switch the provider into a labelled
 *   fixture/limited mode which the UI shows as a development banner.
 * - `AUTH_DEV_LOGIN` is refused in production. Fixture weather is refused in production.
 */

export type NodeEnv = 'development' | 'test' | 'production';

export interface Env {
  NODE_ENV: NodeEnv;
  NEXT_PUBLIC_APP_URL: string;
  DATABASE_URL: string | undefined;
  AUTH_SECRET: string | undefined;
  AUTH_URL: string | undefined;
  EMAIL_SERVER: string | undefined;
  EMAIL_FROM: string;
  AUTH_GOOGLE_ID: string | undefined;
  AUTH_GOOGLE_SECRET: string | undefined;
  AUTH_DEV_LOGIN: boolean;
  STRIPE_SECRET_KEY: string | undefined;
  STRIPE_WEBHOOK_SECRET: string | undefined;
  STRIPE_PRICE_PRO_MONTHLY: string | undefined;
  STRIPE_PRICE_PRO_YEARLY: string | undefined;
  WEATHER_PROVIDER: 'open-meteo' | 'fixture';
  OPEN_METEO_API_KEY: string | undefined;
  OPEN_METEO_BASE_URL: string;
  GEOCODER_PROVIDER: 'nominatim' | 'fixture';
  GEOCODER_USER_AGENT: string;
  TERRAIN_PROVIDER: 'reearth' | 'cesium-ion' | 'ellipsoid';
  CESIUM_ION_TOKEN: string | undefined;
  IMAGERY_PROVIDER: 'natural-earth' | 'cesium-ion' | 'xyz';
  IMAGERY_XYZ_URL: string | undefined;
  IMAGERY_XYZ_ATTRIBUTION: string | undefined;
  IMAGERY_XYZ_MAX_ZOOM: number;
  REFERENCE_IMAGERY_PROVIDER: 'none';
  SENTRY_DSN: string | undefined;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  LIGHTMAP_SHOW_DEV_BANNER: boolean;
}

export interface EnvIssue {
  key: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface EnvResult {
  env: Env;
  issues: EnvIssue[];
  /** True when no `error` issues exist. */
  ok: boolean;
}

type RawEnv = Record<string, string | undefined>;

function str(raw: RawEnv, key: string): string | undefined {
  const v = raw[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function bool(raw: RawEnv, key: string, fallback: boolean): boolean {
  const v = str(raw, key);
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

function oneOf<T extends string>(
  raw: RawEnv,
  key: string,
  allowed: readonly T[],
  fallback: T,
  issues: EnvIssue[],
): T {
  const v = str(raw, key);
  if (v === undefined) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  issues.push({
    key,
    severity: 'error',
    message: `must be one of ${allowed.join(', ')} (got "${v}")`,
  });
  return fallback;
}

function url(raw: RawEnv, key: string, fallback: string, issues: EnvIssue[]): string {
  const v = str(raw, key) ?? fallback;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    return v;
  } catch {
    issues.push({ key, severity: 'error', message: `must be an http(s) URL (got "${v}")` });
    return fallback;
  }
}

/**
 * Parse and validate. Never throws: callers decide whether an `error` is fatal (the CLI exits
 * non-zero; the server refuses to start in production; development logs and continues).
 */
export function parseEnv(raw: RawEnv): EnvResult {
  const issues: EnvIssue[] = [];
  const NODE_ENV = oneOf(
    raw,
    'NODE_ENV',
    ['development', 'test', 'production'] as const,
    'development',
    issues,
  );
  const isProd = NODE_ENV === 'production';

  const env: Env = {
    NODE_ENV,
    NEXT_PUBLIC_APP_URL: url(raw, 'NEXT_PUBLIC_APP_URL', 'http://localhost:3000', issues),
    DATABASE_URL: str(raw, 'DATABASE_URL'),
    AUTH_SECRET: str(raw, 'AUTH_SECRET'),
    AUTH_URL: str(raw, 'AUTH_URL'),
    EMAIL_SERVER: str(raw, 'EMAIL_SERVER'),
    EMAIL_FROM: str(raw, 'EMAIL_FROM') ?? 'LightMap <no-reply@example.com>',
    AUTH_GOOGLE_ID: str(raw, 'AUTH_GOOGLE_ID'),
    AUTH_GOOGLE_SECRET: str(raw, 'AUTH_GOOGLE_SECRET'),
    AUTH_DEV_LOGIN: bool(raw, 'AUTH_DEV_LOGIN', false),
    STRIPE_SECRET_KEY: str(raw, 'STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: str(raw, 'STRIPE_WEBHOOK_SECRET'),
    STRIPE_PRICE_PRO_MONTHLY: str(raw, 'STRIPE_PRICE_PRO_MONTHLY'),
    STRIPE_PRICE_PRO_YEARLY: str(raw, 'STRIPE_PRICE_PRO_YEARLY'),
    WEATHER_PROVIDER: oneOf(
      raw,
      'WEATHER_PROVIDER',
      ['open-meteo', 'fixture'] as const,
      'open-meteo',
      issues,
    ),
    OPEN_METEO_API_KEY: str(raw, 'OPEN_METEO_API_KEY'),
    OPEN_METEO_BASE_URL: url(raw, 'OPEN_METEO_BASE_URL', 'https://api.open-meteo.com', issues),
    GEOCODER_PROVIDER: oneOf(
      raw,
      'GEOCODER_PROVIDER',
      ['nominatim', 'fixture'] as const,
      'nominatim',
      issues,
    ),
    GEOCODER_USER_AGENT: str(raw, 'GEOCODER_USER_AGENT') ?? 'LightMap-dev (unset contact)',
    TERRAIN_PROVIDER: oneOf(
      raw,
      'TERRAIN_PROVIDER',
      ['reearth', 'cesium-ion', 'ellipsoid'] as const,
      'reearth',
      issues,
    ),
    CESIUM_ION_TOKEN: str(raw, 'CESIUM_ION_TOKEN'),
    IMAGERY_PROVIDER: oneOf(
      raw,
      'IMAGERY_PROVIDER',
      ['natural-earth', 'cesium-ion', 'xyz'] as const,
      'natural-earth',
      issues,
    ),
    IMAGERY_XYZ_URL: str(raw, 'IMAGERY_XYZ_URL'),
    IMAGERY_XYZ_ATTRIBUTION: str(raw, 'IMAGERY_XYZ_ATTRIBUTION'),
    IMAGERY_XYZ_MAX_ZOOM: Number(str(raw, 'IMAGERY_XYZ_MAX_ZOOM') ?? '18'),
    REFERENCE_IMAGERY_PROVIDER: oneOf(
      raw,
      'REFERENCE_IMAGERY_PROVIDER',
      ['none'] as const,
      'none',
      issues,
    ),
    SENTRY_DSN: str(raw, 'SENTRY_DSN'),
    LOG_LEVEL: oneOf(raw, 'LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, 'info', issues),
    LIGHTMAP_SHOW_DEV_BANNER: bool(raw, 'LIGHTMAP_SHOW_DEV_BANNER', !isProd),
  };

  // --- cross-field rules -------------------------------------------------------------------
  if (env.AUTH_SECRET !== undefined && env.AUTH_SECRET.length < 32) {
    issues.push({
      key: 'AUTH_SECRET',
      severity: isProd ? 'error' : 'warning',
      message: 'should be at least 32 characters (openssl rand -base64 32)',
    });
  }
  if (isProd) {
    for (const key of ['DATABASE_URL', 'AUTH_SECRET', 'AUTH_URL'] as const) {
      if (env[key] === undefined)
        issues.push({ key, severity: 'error', message: 'required in production' });
    }
    if (env.AUTH_DEV_LOGIN)
      issues.push({
        key: 'AUTH_DEV_LOGIN',
        severity: 'error',
        message: 'must be off in production',
      });
    if (env.WEATHER_PROVIDER === 'fixture')
      issues.push({
        key: 'WEATHER_PROVIDER',
        severity: 'error',
        message: 'fixture weather is not allowed in production (plan §33)',
      });
    if (env.GEOCODER_PROVIDER === 'fixture')
      issues.push({
        key: 'GEOCODER_PROVIDER',
        severity: 'error',
        message: 'fixture geocoder is not allowed in production',
      });
    if (env.GEOCODER_PROVIDER === 'nominatim')
      issues.push({
        key: 'GEOCODER_PROVIDER',
        severity: 'warning',
        message:
          'Nominatim usage policy forbids heavy/commercial use; switch to a contracted geocoder before launch (docs/DATA_SOURCES_AND_LICENSING.md)',
      });
    if (env.WEATHER_PROVIDER === 'open-meteo' && env.OPEN_METEO_API_KEY === undefined)
      issues.push({
        key: 'OPEN_METEO_API_KEY',
        severity: 'warning',
        message: 'Open-Meteo requires a paid API key for commercial use',
      });
    if (env.EMAIL_SERVER === undefined && env.AUTH_GOOGLE_ID === undefined)
      issues.push({
        key: 'EMAIL_SERVER',
        severity: 'error',
        message: 'production needs at least one real sign-in method (email server or Google)',
      });
    if (env.STRIPE_SECRET_KEY !== undefined && env.STRIPE_WEBHOOK_SECRET === undefined)
      issues.push({
        key: 'STRIPE_WEBHOOK_SECRET',
        severity: 'error',
        message: 'required when Stripe is configured',
      });
    if (env.LIGHTMAP_SHOW_DEV_BANNER)
      issues.push({
        key: 'LIGHTMAP_SHOW_DEV_BANNER',
        severity: 'warning',
        message: 'dev banner is on in production',
      });
  }
  if (env.TERRAIN_PROVIDER === 'cesium-ion' && env.CESIUM_ION_TOKEN === undefined) {
    issues.push({
      key: 'CESIUM_ION_TOKEN',
      severity: 'error',
      message: 'required when TERRAIN_PROVIDER=cesium-ion',
    });
  }
  if (env.IMAGERY_PROVIDER === 'cesium-ion' && env.CESIUM_ION_TOKEN === undefined) {
    issues.push({
      key: 'CESIUM_ION_TOKEN',
      severity: 'error',
      message: 'required when IMAGERY_PROVIDER=cesium-ion',
    });
  }
  if (env.IMAGERY_PROVIDER === 'xyz') {
    if (env.IMAGERY_XYZ_URL === undefined)
      issues.push({
        key: 'IMAGERY_XYZ_URL',
        severity: 'error',
        message: 'required when IMAGERY_PROVIDER=xyz',
      });
    if (env.IMAGERY_XYZ_ATTRIBUTION === undefined)
      issues.push({
        key: 'IMAGERY_XYZ_ATTRIBUTION',
        severity: 'error',
        message: 'attribution is mandatory for every imagery source (plan §14)',
      });
  }
  if (
    !Number.isInteger(env.IMAGERY_XYZ_MAX_ZOOM) ||
    env.IMAGERY_XYZ_MAX_ZOOM < 0 ||
    env.IMAGERY_XYZ_MAX_ZOOM > 24
  ) {
    issues.push({
      key: 'IMAGERY_XYZ_MAX_ZOOM',
      severity: 'error',
      message: 'must be an integer 0–24',
    });
  }
  if (
    env.STRIPE_SECRET_KEY !== undefined &&
    isProd &&
    env.STRIPE_SECRET_KEY.startsWith('sk_test_')
  ) {
    issues.push({
      key: 'STRIPE_SECRET_KEY',
      severity: 'error',
      message: 'test-mode key in production',
    });
  }

  return { env, issues, ok: !issues.some((i) => i.severity === 'error') };
}

/** Which capabilities the current environment actually provides — drives the dev banner. */
export interface EnvCapabilities {
  database: boolean;
  auth: boolean;
  devLogin: boolean;
  stripe: boolean;
  liveWeather: boolean;
  liveGeocoder: boolean;
  terrain: boolean;
  detailedImagery: boolean;
  referenceImagery: boolean;
  fixtureMode: boolean;
}

export function envCapabilities(env: Env): EnvCapabilities {
  const liveWeather = env.WEATHER_PROVIDER === 'open-meteo';
  const liveGeocoder = env.GEOCODER_PROVIDER === 'nominatim';
  const detailedImagery = env.IMAGERY_PROVIDER !== 'natural-earth';
  return {
    database: env.DATABASE_URL !== undefined,
    auth: env.AUTH_SECRET !== undefined,
    devLogin: env.AUTH_DEV_LOGIN && env.NODE_ENV !== 'production',
    stripe: env.STRIPE_SECRET_KEY !== undefined && env.STRIPE_WEBHOOK_SECRET !== undefined,
    liveWeather,
    liveGeocoder,
    terrain: env.TERRAIN_PROVIDER !== 'ellipsoid',
    detailedImagery,
    referenceImagery: false,
    fixtureMode: !liveWeather || !liveGeocoder || !detailedImagery,
  };
}

let cached: EnvResult | undefined;

/** Process-wide env, parsed once. Server-side only. */
export function getEnv(): EnvResult {
  if (cached === undefined) cached = parseEnv(process.env);
  return cached;
}

/** Test hook. */
export function resetEnvCache(): void {
  cached = undefined;
}

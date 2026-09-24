/**
 * Observability (plan §13, §31): structured JSON logs, an error-reporter interface (Sentry or
 * equivalent plugs in here; nothing else imports a vendor SDK), and privacy-conscious analytics
 * that never receive precise coordinates or freeform text.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  write?: (line: string) => void;
  now?: () => string;
  bindings?: Record<string, unknown>;
}

const REDACT_KEYS = /token|secret|password|authorization|cookie|apikey|api_key|email/i;

/** Redact obvious secrets and PII keys before they reach a log line. */
export function redact(
  meta: Record<string, unknown>,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  seen.add(meta);
  for (const [k, v] of Object.entries(meta)) {
    if (REDACT_KEYS.test(k)) out[k] = '[redacted]';
    else if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Date) &&
      !(v instanceof Error)
    ) {
      // Metadata is caller-supplied: a cycle or a deep graph must not take the logger down.
      if (seen.has(v)) out[k] = '[circular]';
      else if (depth >= 8) out[k] = '[nested]';
      else out[k] = redact(v as Record<string, unknown>, seen, depth + 1);
    } else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else if (typeof v === 'bigint') out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = LEVELS[opts.level ?? 'info'];
  const write = opts.write ?? ((line: string) => console.log(line));
  const now = opts.now ?? (() => new Date().toISOString());
  const bindings = opts.bindings ?? {};
  const emit = (lvl: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (LEVELS[lvl] < level) return;
    write(
      JSON.stringify({
        time: now(),
        level: lvl,
        message,
        ...redact(bindings),
        ...(meta ? redact(meta) : {}),
      }),
    );
  };
  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
    child: (b) => createLogger({ ...opts, bindings: { ...bindings, ...b } }),
  };
}

export interface ErrorReporter {
  /**
   * Report an error. Never throws. Returns a promise that settles when the report has been sent
   * (or given up on), so a serverless route can keep the function alive with `after()`; the
   * logging reporter resolves immediately.
   */
  capture(error: unknown, context?: Record<string, unknown>): Promise<void>;
}

/** Default reporter: logs. Replace with a Sentry-backed implementation when SENTRY_DSN is set (docs/ARCHITECTURE.md). */
export function loggingErrorReporter(log: Logger): ErrorReporter {
  return {
    capture: (error, context) => {
      log.error('unhandled error', { error, ...(context ?? {}) });
      return Promise.resolve();
    },
  };
}

export type AnalyticsEvent =
  | 'location_selected'
  | 'timeline_scrubbed'
  | 'weather_scenario_changed'
  | 'project_created'
  | 'viewpoint_saved'
  | 'preview_expanded'
  | 'upgrade_started'
  | 'subscription_started';

export interface AnalyticsSink {
  track(event: AnalyticsEvent, props?: Record<string, string | number | boolean>): void;
}

/**
 * Coordinates are quantised to ~1° (≈ 110 km) before they may appear in analytics (plan §31).
 * Nothing finer ever leaves the app.
 */
export function quantizeForAnalytics(
  lat: number,
  lng: number,
): { latBucket: number; lngBucket: number } {
  return { latBucket: Math.round(lat), lngBucket: Math.round(lng) };
}

const FORBIDDEN_PROPS =
  /^(lat|latitude|lng|lon|longitude|notes|description|email|name|label|query)$/i;

/** Drop any property that looks like precise location or freeform text, whatever the caller passed. */
export function sanitizeAnalyticsProps(
  props: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_PROPS.test(k)) continue;
    if (typeof v === 'string' && v.length > 64) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function noopAnalytics(): AnalyticsSink {
  return { track: () => {} };
}

export function loggingAnalytics(log: Logger): AnalyticsSink {
  return {
    track: (event, props) =>
      log.info(`analytics ${event}`, props ? sanitizeAnalyticsProps(props) : {}),
  };
}

/** Request budgeting metrics (plan §19): names shared by the API and the cost model. */
export const BUDGET_RESOURCES = [
  'weather',
  'geocoder',
  'imagery',
  'terrain_bytes',
  'preview',
  'climatology',
] as const;
export type BudgetResource = (typeof BUDGET_RESOURCES)[number];

export const DAILY_BUDGET_LIMITS: Record<
  BudgetResource,
  { anonymous: number; free: number; pro: number }
> = {
  weather: { anonymous: 40, free: 150, pro: 600 },
  geocoder: { anonymous: 30, free: 100, pro: 400 },
  imagery: { anonymous: 0, free: 0, pro: 0 },
  terrain_bytes: { anonymous: 300e6, free: 1e9, pro: 5e9 },
  preview: { anonymous: 200, free: 1000, pro: 5000 },
  // One summary = up to ten archive requests upstream; cached 30 days per 0.5° cell.
  climatology: { anonymous: 0, free: 0, pro: 60 },
};
export * from './sentry-envelope.ts';

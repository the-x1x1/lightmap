/**
 * Product analytics beacon (plan §31): the shape the client sends to `POST /api/analytics` and
 * the validation the route applies. Pure, so the route's rules are unit-tested without Next.
 *
 * Every event has a fixed property list with a fixed type for each; anything else in the body is
 * dropped, not just the forbidden names `sanitizeAnalyticsProps` knows. Coordinates can only
 * arrive as whole-degree buckets and are re-rounded here whatever the client sent
 * (docs/PRIVACY.md §4).
 */
import {
  isAnalyticsEvent,
  sanitizeAnalyticsProps,
  type AnalyticsEvent,
} from '@lightmap/observability';
import { isScenarioId } from '@lightmap/weather';

export interface AnalyticsBeacon {
  event: AnalyticsEvent;
  props: Record<string, string | number | boolean>;
}

/** A beacon body larger than this is refused outright (4 KB is already generous). */
export const MAX_ANALYTICS_BODY_BYTES = 4096;

type PropRule =
  | { kind: 'int'; min: number; max: number }
  | { kind: 'bool' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'scenario' };

const LOCATION_SOURCES = ['search', 'map-click', 'coordinates', 'device', 'saved', 'fixture'];

/** The properties each event may carry (PRIVACY.md §4 lists them in words). */
export const ANALYTICS_PROPS: Record<AnalyticsEvent, Record<string, PropRule>> = {
  location_selected: {
    source: { kind: 'enum', values: LOCATION_SOURCES },
    latBucket: { kind: 'int', min: -90, max: 90 },
    lngBucket: { kind: 'int', min: -180, max: 180 },
  },
  timeline_scrubbed: { steps: { kind: 'int', min: 1, max: 100_000 } },
  weather_scenario_changed: { scenario: { kind: 'scenario' } },
  project_created: {},
  viewpoint_saved: { variant: { kind: 'bool' } },
  preview_expanded: { camera: { kind: 'enum', values: ['map', 'viewpoint'] } },
  upgrade_started: { interval: { kind: 'enum', values: ['monthly', 'yearly'] } },
  subscription_started: { plan: { kind: 'enum', values: ['free', 'pro', 'studio', 'unknown'] } },
};

function accept(rule: PropRule, v: string | number | boolean): string | number | boolean | null {
  switch (rule.kind) {
    case 'int': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      const n = Math.round(v);
      return n < rule.min || n > rule.max ? null : n;
    }
    case 'bool':
      return typeof v === 'boolean' ? v : null;
    case 'enum':
      return typeof v === 'string' && rule.values.includes(v) ? v : null;
    case 'scenario':
      return typeof v === 'string' && isScenarioId(v) ? v : null;
  }
}

/**
 * Validate a beacon: a known event name and, optionally, an object of properties, of which only
 * the event's own, correctly typed ones survive. Unknown events are an error; unknown or
 * mistyped properties are silently dropped.
 */
export function parseAnalyticsBeacon(body: unknown): AnalyticsBeacon {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('expected an object');
  const o = body as Record<string, unknown>;
  const event = o['event'];
  if (!isAnalyticsEvent(event)) throw new Error('event is not a known product event');
  const rawProps = o['props'];
  if (
    rawProps !== undefined &&
    (!rawProps || typeof rawProps !== 'object' || Array.isArray(rawProps))
  )
    throw new Error('props must be an object');
  const scalars = sanitizeAnalyticsProps((rawProps as Record<string, unknown> | undefined) ?? {});
  const rules = ANALYTICS_PROPS[event];
  const props: Record<string, string | number | boolean> = {};
  for (const [k, rule] of Object.entries(rules)) {
    const v = scalars[k];
    if (v === undefined) continue;
    const ok = accept(rule, v);
    if (ok !== null) props[k] = ok;
  }
  return { event, props };
}

/**
 * Preferences (plan §17): the few settings a photographer carries between places — units, which
 * zone times are shown in, and the lens the camera starts with. Shared by the API route (as the
 * patch validator) and the client (as the defaults), so it imports nothing server- or
 * browser-only.
 */
import type { ProfileDto } from './api-types.ts';

export type Preferences = ProfileDto;
export type Units = Preferences['units'];
export type TimeZoneMode = Preferences['defaultTimezoneBehavior'];

export const UNITS = ['metric', 'imperial'] as const;
export const TIME_ZONE_MODES = ['location', 'device'] as const;

/** Lens limits, full-frame equivalent: a fisheye to a long telephoto. */
export const DEFAULT_LENS_MIN_MM = 8;
export const DEFAULT_LENS_MAX_MM = 600;

export const DEFAULT_PREFERENCES: Preferences = {
  units: 'metric',
  defaultTimezoneBehavior: 'location',
  defaultLensEquivalentMm: 24,
};

/**
 * Validate a preferences patch: any subset of the fields, each checked. Throws a plain `Error`
 * with a user-readable message (the route turns it into a 400). Unknown keys are ignored.
 */
export function parsePreferencesPatch(body: unknown): Partial<Preferences> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('expected an object');
  const o = body as Record<string, unknown>;
  const out: Partial<Preferences> = {};
  if (o['units'] !== undefined) {
    if (!isOneOf(o['units'], UNITS)) throw new Error(`units must be one of ${UNITS.join(', ')}`);
    out.units = o['units'];
  }
  if (o['defaultTimezoneBehavior'] !== undefined) {
    if (!isOneOf(o['defaultTimezoneBehavior'], TIME_ZONE_MODES))
      throw new Error(`defaultTimezoneBehavior must be one of ${TIME_ZONE_MODES.join(', ')}`);
    out.defaultTimezoneBehavior = o['defaultTimezoneBehavior'];
  }
  if (o['defaultLensEquivalentMm'] !== undefined) {
    const mm = o['defaultLensEquivalentMm'];
    if (
      typeof mm !== 'number' ||
      !Number.isInteger(mm) ||
      mm < DEFAULT_LENS_MIN_MM ||
      mm > DEFAULT_LENS_MAX_MM
    )
      throw new Error(
        `defaultLensEquivalentMm must be a whole number between ${DEFAULT_LENS_MIN_MM} and ${DEFAULT_LENS_MAX_MM}`,
      );
    out.defaultLensEquivalentMm = mm;
  }
  if (Object.keys(out).length === 0) throw new Error('nothing to change');
  return out;
}

/** Fill a possibly partial or malformed stored object (older local storage, a stale cache) from the defaults. */
export function normalizePreferences(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFERENCES };
  const o = raw as Record<string, unknown>;
  const mm = o['defaultLensEquivalentMm'];
  return {
    units: isOneOf(o['units'], UNITS) ? o['units'] : DEFAULT_PREFERENCES.units,
    defaultTimezoneBehavior: isOneOf(o['defaultTimezoneBehavior'], TIME_ZONE_MODES)
      ? o['defaultTimezoneBehavior']
      : DEFAULT_PREFERENCES.defaultTimezoneBehavior,
    defaultLensEquivalentMm:
      typeof mm === 'number' &&
      Number.isInteger(mm) &&
      mm >= DEFAULT_LENS_MIN_MM &&
      mm <= DEFAULT_LENS_MAX_MM
        ? mm
        : DEFAULT_PREFERENCES.defaultLensEquivalentMm,
  };
}

function isOneOf<T extends string>(x: unknown, allowed: readonly T[]): x is T {
  return typeof x === 'string' && (allowed as readonly string[]).includes(x);
}

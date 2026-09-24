/**
 * Deterministic development locations (plan §33). Tests and the fixture geocoder use these.
 * Production never silently uses them: `FixtureGeocoder.meta.isFixture` is true and env
 * validation refuses `GEOCODER_PROVIDER=fixture` in production.
 */
import type { GeoPoint } from '../geo.ts';
import type { GeocodingProvider, Place, ProviderMeta, TimezoneProvider } from './types.ts';

export interface DevLocation {
  id: string;
  label: string;
  point: GeoPoint;
  timezone: string;
  countryCode: string;
}

export const DEV_LOCATIONS: readonly DevLocation[] = [
  { id: 'kailua-beach', label: 'Kailua Beach, Hawaii, USA', point: { latitude: 21.397, longitude: -157.727, elevationM: 2 }, timezone: 'Pacific/Honolulu', countryCode: 'US' },
  { id: 'grand-canyon', label: 'Grand Canyon, Mather Point, Arizona, USA', point: { latitude: 36.0617, longitude: -112.1078, elevationM: 2170 }, timezone: 'America/Phoenix', countryCode: 'US' },
  { id: 'manhattan', label: 'Manhattan, New York, USA', point: { latitude: 40.7484, longitude: -73.9857, elevationM: 15 }, timezone: 'America/New_York', countryCode: 'US' },
  { id: 'london', label: 'London, United Kingdom', point: { latitude: 51.5074, longitude: -0.1278, elevationM: 11 }, timezone: 'Europe/London', countryCode: 'GB' },
  { id: 'sydney', label: 'Sydney, Australia', point: { latitude: -33.8688, longitude: 151.2093, elevationM: 20 }, timezone: 'Australia/Sydney', countryCode: 'AU' },
  { id: 'tromso', label: 'Tromsø, Norway', point: { latitude: 69.6492, longitude: 18.9553, elevationM: 10 }, timezone: 'Europe/Oslo', countryCode: 'NO' },
];

const FIXTURE_META: ProviderMeta = {
  id: 'fixture-geocoder',
  name: 'Development fixtures',
  attribution: 'Development fixture data — not a live source',
  license: 'Proprietary (LightMap test data)',
  review: 'development-only',
  isFixture: true,
  cache: { allowed: true, maxAgeSeconds: 0 },
};

export class FixtureGeocoder implements GeocodingProvider {
  readonly meta = FIXTURE_META;

  async search(query: string, opts?: { limit?: number }): Promise<Place[]> {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const hits = DEV_LOCATIONS.filter((l) => l.label.toLowerCase().includes(q) || l.id.includes(q.replace(/\s+/g, '-')));
    return hits.slice(0, opts?.limit ?? 5).map(toPlace);
  }

  async reverse(point: GeoPoint): Promise<Place | null> {
    let best: DevLocation | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const l of DEV_LOCATIONS) {
      const d = (l.point.latitude - point.latitude) ** 2 + (l.point.longitude - point.longitude) ** 2;
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best && bestD < 1 ? toPlace(best) : null;
  }
}

function toPlace(l: DevLocation): Place {
  return { label: l.label, point: l.point, countryCode: l.countryCode, sourceId: `fixture:${l.id}` };
}

/**
 * Fixture timezone lookup: nearest dev location within ~5°, else a longitude-based UTC offset
 * zone ("Etc/GMT-10" style). Good enough for tests; production uses `GeoTzTimezoneProvider`.
 */
export class FixtureTimezoneProvider implements TimezoneProvider {
  readonly meta: ProviderMeta = { ...FIXTURE_META, id: 'fixture-timezone', name: 'Development fixture time zones' };

  async lookup(point: GeoPoint): Promise<string | null> {
    for (const l of DEV_LOCATIONS) {
      if (Math.abs(l.point.latitude - point.latitude) < 5 && Math.abs(l.point.longitude - point.longitude) < 5) return l.timezone;
    }
    return etcZoneForLongitude(point.longitude);
  }
}

/** Nautical zone for a longitude, as an IANA "Etc/GMT±N" id (note the inverted sign convention). */
export function etcZoneForLongitude(longitude: number): string {
  const offset = Math.round(longitude / 15);
  if (offset === 0) return 'Etc/UTC';
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
}

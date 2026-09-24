import 'server-only';
import type { GeoPoint, ProviderMeta, TimezoneProvider } from '@lightmap/geospatial';
import { etcZoneForLongitude } from '@lightmap/geospatial';

/**
 * geo-tz (MIT) resolves an IANA zone from coordinates using bundled timezone-boundary polygons
 * (ODbL-derived data from timezone-boundary-builder, attribution in THIRD_PARTY_NOTICES.md).
 * Node-only, ~40 MB of data, loaded lazily on first use. Open ocean → nautical Etc zone.
 */
export class GeoTzTimezoneProvider implements TimezoneProvider {
  readonly meta: ProviderMeta = {
    id: 'geo-tz',
    name: 'geo-tz (timezone-boundary-builder)',
    attribution: 'Time zone boundaries © timezone-boundary-builder contributors (ODbL)',
    attributionUrl: 'https://github.com/evansiroky/timezone-boundary-builder',
    license: 'MIT (code); ODbL (boundary data, derived from OpenStreetMap)',
    review: 'approved',
    isFixture: false,
    cache: { allowed: true, maxAgeSeconds: 60 * 60 * 24 * 365 },
  };
  private mod: Promise<{ find: (lat: number, lon: number) => string[] }> | null = null;

  async lookup(point: GeoPoint): Promise<string | null> {
    try {
      this.mod ??= import('geo-tz') as Promise<{ find: (lat: number, lon: number) => string[] }>;
      const { find } = await this.mod;
      const zones = find(point.latitude, point.longitude);
      const z = zones[0];
      if (z && !z.startsWith('Etc/')) return z;
      return etcZoneForLongitude(point.longitude);
    } catch {
      return etcZoneForLongitude(point.longitude);
    }
  }
}

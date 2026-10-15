import 'server-only';
import type { GeoPoint, ProviderMeta, TimezoneProvider } from '@lightmap/geospatial';
import { etcZoneForLongitude } from '@lightmap/geospatial';

/**
 * geo-tz (MIT) resolves an IANA zone from coordinates using bundled timezone-boundary polygons
 * (ODbL-derived data from timezone-boundary-builder, attribution in THIRD_PARTY_NOTICES.md).
 * Node-only, ~40 MB of data, loaded lazily on first use. Open ocean → nautical Etc zone.
 *
 * The comprehensive dataset (`geo-tz/all`, imported by its typed path), not the package
 * default: the default merges every zone that has kept the same clocks since 1970, so Oslo,
 * Copenhagen and Stockholm came back as Europe/Berlin and Amsterdam as Europe/Brussels (V&V,
 * Tromso) - the right times under a name the photographer does not recognise. Every dataset
 * ships in the package's data folder (the desktop stage copies it whole).
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
      this.mod ??= (
        import('geo-tz/dist/find-all') as Promise<{ find: (lat: number, lon: number) => string[] }>
      ).catch(() => import('geo-tz') as Promise<{ find: (lat: number, lon: number) => string[] }>);
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

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
  private all: Promise<Finder | null> | null = null;
  private merged: Promise<Finder | null> | null = null;

  async lookup(point: GeoPoint): Promise<string | null> {
    // The comprehensive dataset's entry is exported as `geo-tz/all` (the README's typed path is
    // dist/find-all); whichever this install resolves. Not literal imports: the package is a
    // server external, resolved by Node at run time (stage.mjs copies its dist and data).
    this.all ??= loadFinder('geo-tz/all')
      .catch(() => loadFinder('geo-tz/dist/find-all'))
      .catch(() => null);
    this.merged ??= (import('geo-tz') as Promise<Finder>).catch(() => null);
    // The comprehensive dataset first; a zone this runtime's ICU does not know (the newest
    // splits) falls back to the merged dataset's name for the same clocks.
    for (const job of [this.all, this.merged]) {
      try {
        const finder = await job;
        const z = finder?.find(point.latitude, point.longitude)[0];
        if (z && !z.startsWith('Etc/') && isKnownZone(z)) return z;
        if (z?.startsWith('Etc/')) break; // open sea: the nautical zone below
      } catch {
        /* the next dataset */
      }
    }
    return etcZoneForLongitude(point.longitude);
  }
}

type Finder = { find: (lat: number, lon: number) => string[] };

function loadFinder(specifier: string): Promise<Finder> {
  return import(/* webpackIgnore: true */ specifier) as Promise<Finder>;
}

function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

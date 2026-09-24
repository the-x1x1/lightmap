/**
 * Provider registry (plan §12): selects configured implementations from the validated env. This
 * is the only place that knows which vendor is behind which interface. Server-side only — the
 * browser receives descriptors (URLs, attribution) and never credentials.
 */
import type { Env } from '@lightmap/config';
import { FixtureGeocoder, FixtureTimezoneProvider } from './fixtures.ts';
import {
  CesiumIonBasemap,
  CesiumIonTerrainProvider,
  EllipsoidTerrainProvider,
  NaturalEarthBasemap,
  ReearthTerrainProvider,
  XyzBasemap,
} from './map-sources.ts';
import { NominatimGeocoder } from './nominatim.ts';
import type {
  GeocodingProvider,
  ImageryProvider,
  MapTileProvider,
  ProviderMeta,
  TerrainProvider,
  TimezoneProvider,
} from './types.ts';

export interface GeospatialProviders {
  geocoder: GeocodingProvider;
  timezone: TimezoneProvider;
  terrain: TerrainProvider;
  basemap: MapTileProvider;
  /** Null until a licensed provider contract exists (plan §7). */
  referenceImagery: ImageryProvider | null;
}

export interface RegistryOptions {
  fetchImpl?: typeof fetch;
  /** Injected to keep the geo-tz data dependency out of this package's import graph. */
  timezoneProvider?: TimezoneProvider;
}

export function createGeospatialProviders(
  env: Env,
  opts: RegistryOptions = {},
): GeospatialProviders {
  const geocoder: GeocodingProvider =
    env.GEOCODER_PROVIDER === 'nominatim'
      ? new NominatimGeocoder({
          userAgent: env.GEOCODER_USER_AGENT,
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        })
      : new FixtureGeocoder();

  const timezone = opts.timezoneProvider ?? new FixtureTimezoneProvider();

  let terrain: TerrainProvider;
  switch (env.TERRAIN_PROVIDER) {
    case 'reearth':
      terrain = new ReearthTerrainProvider(opts.fetchImpl);
      break;
    case 'cesium-ion':
      terrain = env.CESIUM_ION_TOKEN
        ? new CesiumIonTerrainProvider()
        : new EllipsoidTerrainProvider();
      break;
    case 'ellipsoid':
      terrain = new EllipsoidTerrainProvider();
      break;
  }

  let basemap: MapTileProvider;
  switch (env.IMAGERY_PROVIDER) {
    case 'xyz':
      basemap =
        env.IMAGERY_XYZ_URL && env.IMAGERY_XYZ_ATTRIBUTION
          ? new XyzBasemap({
              url: env.IMAGERY_XYZ_URL,
              attribution: env.IMAGERY_XYZ_ATTRIBUTION,
              maxZoom: env.IMAGERY_XYZ_MAX_ZOOM,
            })
          : new NaturalEarthBasemap();
      break;
    case 'cesium-ion':
      basemap = env.CESIUM_ION_TOKEN ? new CesiumIonBasemap() : new NaturalEarthBasemap();
      break;
    case 'natural-earth':
      basemap = new NaturalEarthBasemap();
      break;
  }

  return { geocoder, timezone, terrain, basemap, referenceImagery: null };
}

/** Everything the UI must attribute for the active configuration. */
export function activeAttributions(p: GeospatialProviders): ProviderMeta[] {
  const list = [p.basemap.meta, p.terrain.meta, p.geocoder.meta];
  if (p.referenceImagery) list.push(p.referenceImagery.meta);
  return list.filter((m) => m.attribution.length > 0);
}

/** Public, credential-free view of the active providers for `/api/scene/capabilities`. */
export interface PublicProviderDescriptors {
  terrain: ReturnType<TerrainProvider['descriptor']> & { providerId: string; isFixture: boolean };
  basemap: ReturnType<MapTileProvider['descriptor']> & {
    providerId: string;
    detailLevel: MapTileProvider['detailLevel'];
    isFixture: boolean;
  };
  geocoderId: string;
  geocoderIsFixture: boolean;
  referenceImagery: boolean;
  attributions: Array<Pick<ProviderMeta, 'id' | 'attribution' | 'attributionUrl'>>;
}

export function publicDescriptors(p: GeospatialProviders): PublicProviderDescriptors {
  return {
    terrain: {
      ...p.terrain.descriptor(),
      providerId: p.terrain.meta.id,
      isFixture: p.terrain.meta.isFixture,
    },
    basemap: {
      ...p.basemap.descriptor(),
      providerId: p.basemap.meta.id,
      detailLevel: p.basemap.detailLevel,
      isFixture: p.basemap.meta.isFixture,
    },
    geocoderId: p.geocoder.meta.id,
    geocoderIsFixture: p.geocoder.meta.isFixture,
    referenceImagery: p.referenceImagery !== null,
    attributions: activeAttributions(p).map((m) => ({
      id: m.id,
      attribution: m.attribution,
      ...(m.attributionUrl ? { attributionUrl: m.attributionUrl } : {}),
    })),
  };
}

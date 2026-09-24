/**
 * Provider interfaces (plan §12). Every external source sits behind one of these. UI code never
 * imports a vendor SDK; API routes resolve implementations through the registry.
 *
 * Each provider carries `ProviderMeta`: licence, attribution and commercial-review state travel
 * with the implementation so the UI can show attribution and CI can check that every source is
 * documented (scripts/check-attribution.ts).
 */
import type { GeoPoint } from '../geo.ts';

export type CommercialReview = 'approved' | 'conditional' | 'development-only' | 'blocked';

export interface ProviderMeta {
  /** Stable id, also the key in docs/DATA_SOURCES_AND_LICENSING.md. */
  id: string;
  name: string;
  /** Attribution text the UI must display whenever this provider's data is on screen. */
  attribution: string;
  attributionUrl?: string;
  license: string;
  termsUrl?: string;
  review: CommercialReview;
  /** True for fixtures and dev-only sources: the UI shows the development banner. */
  isFixture: boolean;
  /** Whether responses may be cached server-side, and for how long. */
  cache: { allowed: boolean; maxAgeSeconds: number };
}

export interface Place {
  label: string;
  point: GeoPoint;
  /** ISO 3166-1 alpha-2 when known. */
  countryCode?: string;
  /** Provider-specific id for attribution/debugging; never used for authorization. */
  sourceId?: string;
  bounds?: { west: number; south: number; east: number; north: number };
}

export interface GeocodingProvider {
  readonly meta: ProviderMeta;
  search(query: string, opts?: { limit?: number; signal?: AbortSignal }): Promise<Place[]>;
  reverse(point: GeoPoint, opts?: { signal?: AbortSignal }): Promise<Place | null>;
}

export interface TimezoneProvider {
  readonly meta: ProviderMeta;
  /** IANA zone id such as "Pacific/Honolulu", or null when the point is outside every zone polygon (open ocean). */
  lookup(point: GeoPoint): Promise<string | null>;
}

export interface TerrainDescriptor {
  kind: 'ellipsoid' | 'quantized-mesh' | 'cesium-ion';
  /** For quantized-mesh: the layer.json base URL. */
  url?: string;
  /** For cesium-ion: the asset id (1 = Cesium World Terrain). Token is injected server-side via a short-lived proxy or public token. */
  assetId?: number;
  attribution: string;
}

export interface TerrainProvider {
  readonly meta: ProviderMeta;
  /** What the renderer loads. */
  descriptor(): TerrainDescriptor;
  /** Elevation at a point, metres above sea level, or null when unavailable. */
  sampleElevation(point: GeoPoint, opts?: { signal?: AbortSignal }): Promise<number | null>;
}

export interface BasemapDescriptor {
  kind: 'cesium-natural-earth' | 'xyz' | 'cesium-ion';
  url?: string;
  assetId?: number;
  maxZoom?: number;
  attribution: string;
}

export interface MapTileProvider {
  readonly meta: ProviderMeta;
  descriptor(): BasemapDescriptor;
  /** Rough native resolution, used to grade environment confidence. */
  detailLevel: 'coarse' | 'regional' | 'street';
}

export interface BuildingProvider {
  readonly meta: ProviderMeta;
  /** 3D Tiles URL for buildings near the point, or null when none is licensed/available. */
  tilesetUrl(point: GeoPoint): Promise<string | null>;
}

/** Real-reference imagery (plan §7). Disabled in v0.1; the interface exists so the UI can be built against it. */
export interface ImageryReference {
  id: string;
  url: string;
  thumbnailUrl?: string;
  attribution: string;
  license: string;
  sourceUrl?: string;
  capturedAtUtc?: string;
  headingDegrees?: number;
  point: GeoPoint;
  distanceM: number;
  allowedDisplayModes: Array<'inline' | 'link-only'>;
  allowedCaching: 'none' | 'thumbnail' | 'full';
}

export interface ImageryProvider {
  readonly meta: ProviderMeta;
  availabilityNear(
    point: GeoPoint,
    radiusM: number,
    opts?: { signal?: AbortSignal },
  ): Promise<number>;
  getReferences(
    point: GeoPoint,
    radiusM: number,
    opts?: { limit?: number; signal?: AbortSignal },
  ): Promise<ImageryReference[]>;
}

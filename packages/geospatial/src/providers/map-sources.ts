/**
 * Terrain and basemap sources. The catalogue shape (id, attribution, commercial review state,
 * credential requirement, terms URL) follows a pattern from the owner's WorldView repository
 * (`render-core/map-providers.ts`); the entries are LightMap's own and were re-verified against
 * each provider's published terms (docs/DATA_SOURCES_AND_LICENSING.md).
 *
 * Rule encoded here: a `conditional` or `development-only` source is never a default, and a source
 * that needs a credential is unavailable until the credential exists.
 */
import type { GeoPoint } from '../geo.ts';
import type {
  BasemapDescriptor,
  MapTileProvider,
  ProviderMeta,
  TerrainDescriptor,
  TerrainProvider,
} from './types.ts';

// ---------------------------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------------------------

export const REEARTH_TERRAIN_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
export const REEARTH_HEIGHTS_URL = 'https://terrain.reearth.land/heights.json';

export const REEARTH_TERRAIN_META: ProviderMeta = {
  id: 'reearth-mapterhorn-terrain',
  name: 'Re:Earth Terrain (Mapterhorn DEM)',
  attribution: 'Terrain: Re:Earth · Mapterhorn (CC BY 4.0) · EGM2008 (NGA)',
  attributionUrl: 'https://terrain.reearth.land/',
  license: 'DEM: Mapterhorn, CC BY 4.0; geoid: EGM2008 public domain',
  termsUrl: 'https://terrain.reearth.land/',
  review: 'approved',
  isFixture: false,
  cache: { allowed: true, maxAgeSeconds: 60 * 60 * 24 * 30 },
};

export class ReearthTerrainProvider implements TerrainProvider {
  readonly meta = REEARTH_TERRAIN_META;
  private readonly fetchImpl: typeof fetch;
  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  descriptor(): TerrainDescriptor {
    return { kind: 'quantized-mesh', url: REEARTH_TERRAIN_URL, attribution: this.meta.attribution };
  }

  /**
   * Re:Earth exposes a heights endpoint; the response shape is documented on the terrain site. We
   * treat any failure as "unknown" — the renderer samples terrain itself once tiles load, and the
   * viewpoint falls back to eye-height above the ellipsoid.
   */
  async sampleElevation(point: GeoPoint, opts?: { signal?: AbortSignal }): Promise<number | null> {
    try {
      const url = new URL(REEARTH_HEIGHTS_URL);
      url.searchParams.set('lat', point.latitude.toFixed(6));
      url.searchParams.set('lon', point.longitude.toFixed(6));
      const init: RequestInit = {};
      if (opts?.signal !== undefined) init.signal = opts.signal;
      const res = await this.fetchImpl(url, init);
      if (!res.ok) return null;
      const body = (await res.json()) as unknown;
      return extractHeight(body);
    } catch {
      return null;
    }
  }
}

/** Tolerant reader for `{height}`, `{heights:[..]}`, `{elevation}` or a bare number. */
export function extractHeight(body: unknown): number | null {
  if (typeof body === 'number') return Number.isFinite(body) ? body : null;
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const key of ['height', 'elevation', 'h']) {
      const v = o[key];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    const arr = o['heights'];
    if (Array.isArray(arr) && typeof arr[0] === 'number' && Number.isFinite(arr[0])) return arr[0];
  }
  return null;
}

export const ELLIPSOID_TERRAIN_META: ProviderMeta = {
  id: 'ellipsoid',
  name: 'Flat ellipsoid (no terrain)',
  attribution: '',
  license: 'n/a',
  review: 'approved',
  isFixture: false,
  cache: { allowed: true, maxAgeSeconds: 0 },
};

export class EllipsoidTerrainProvider implements TerrainProvider {
  readonly meta = ELLIPSOID_TERRAIN_META;
  descriptor(): TerrainDescriptor {
    return { kind: 'ellipsoid', attribution: '' };
  }
  async sampleElevation(): Promise<number | null> {
    return null;
  }
}

export const CESIUM_ION_TERRAIN_META: ProviderMeta = {
  id: 'cesium-world-terrain',
  name: 'Cesium World Terrain (ion)',
  attribution: 'Cesium World Terrain © Cesium ion',
  attributionUrl: 'https://cesium.com/legal/',
  license: 'Commercial — per Cesium ion plan',
  termsUrl: 'https://cesium.com/legal/terms-of-service/',
  review: 'conditional',
  isFixture: false,
  cache: { allowed: false, maxAgeSeconds: 0 },
};

export class CesiumIonTerrainProvider implements TerrainProvider {
  readonly meta = CESIUM_ION_TERRAIN_META;
  descriptor(): TerrainDescriptor {
    return { kind: 'cesium-ion', assetId: 1, attribution: this.meta.attribution };
  }
  async sampleElevation(): Promise<number | null> {
    return null; // sampled by the renderer from loaded tiles
  }
}

// ---------------------------------------------------------------------------------------------
// Basemaps
// ---------------------------------------------------------------------------------------------

export const NATURAL_EARTH_META: ProviderMeta = {
  id: 'natural-earth-ii',
  name: 'Natural Earth II (bundled with CesiumJS)',
  attribution: 'Natural Earth II — public domain',
  attributionUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
  license: 'Public domain',
  review: 'approved',
  isFixture: false,
  cache: { allowed: true, maxAgeSeconds: 60 * 60 * 24 * 365 },
};

export class NaturalEarthBasemap implements MapTileProvider {
  readonly meta = NATURAL_EARTH_META;
  readonly detailLevel = 'coarse' as const;
  descriptor(): BasemapDescriptor {
    return { kind: 'cesium-natural-earth', attribution: this.meta.attribution };
  }
}

export class XyzBasemap implements MapTileProvider {
  readonly meta: ProviderMeta;
  readonly detailLevel: 'regional' | 'street';
  private readonly opts: {
    url: string;
    attribution: string;
    maxZoom: number;
    name?: string;
    termsUrl?: string;
  };
  constructor(opts: {
    url: string;
    attribution: string;
    maxZoom: number;
    name?: string;
    termsUrl?: string;
  }) {
    this.opts = opts;
    this.meta = {
      id: 'xyz-imagery',
      name: opts.name ?? 'Operator-configured XYZ imagery',
      attribution: opts.attribution,
      license: 'Per operator contract',
      review: 'conditional',
      isFixture: false,
      cache: { allowed: false, maxAgeSeconds: 0 },
      ...(opts.termsUrl !== undefined ? { termsUrl: opts.termsUrl } : {}),
    };
    this.detailLevel = opts.maxZoom >= 16 ? 'street' : 'regional';
  }
  descriptor(): BasemapDescriptor {
    return {
      kind: 'xyz',
      url: this.opts.url,
      maxZoom: this.opts.maxZoom,
      attribution: this.opts.attribution,
    };
  }
}

export const CESIUM_ION_IMAGERY_META: ProviderMeta = {
  id: 'cesium-ion-imagery',
  name: 'Bing Maps Aerial via Cesium ion',
  attribution: '© Microsoft Bing Maps · via Cesium ion',
  attributionUrl: 'https://cesium.com/legal/',
  license: 'Commercial — per Cesium ion plan',
  termsUrl: 'https://cesium.com/legal/terms-of-service/',
  review: 'conditional',
  isFixture: false,
  cache: { allowed: false, maxAgeSeconds: 0 },
};

export class CesiumIonBasemap implements MapTileProvider {
  readonly meta = CESIUM_ION_IMAGERY_META;
  readonly detailLevel = 'street' as const;
  descriptor(): BasemapDescriptor {
    return { kind: 'cesium-ion', assetId: 2, attribution: this.meta.attribution };
  }
}

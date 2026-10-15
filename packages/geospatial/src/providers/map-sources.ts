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
  BuildingsDescriptor,
  BuildingsProvider,
  LandCoverDescriptor,
  LandCoverProvider,
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

/**
 * Sentinel-2 cloudless 2016 by EOX: a cloud-free mosaic of the whole Earth at 10 m, served free
 * as Web Mercator tiles. The 2016 edition is CC BY 4.0 (later editions are non-commercial, so
 * this layer must stay the 2016 one). Roughly fifty times finer than Natural Earth II: fields,
 * towns, beaches and forests show; single buildings do not.
 */
export const SENTINEL2_CLOUDLESS_META: ProviderMeta = {
  id: 'sentinel-2-cloudless-2016',
  name: 'Sentinel-2 cloudless 2016 (EOX)',
  attribution:
    'Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)',
  attributionUrl: 'https://s2maps.eu',
  license: 'CC BY 4.0',
  termsUrl: 'https://cloudless.eox.at/license-non-commercial',
  review: 'approved',
  isFixture: false,
  cache: { allowed: true, maxAgeSeconds: 60 * 60 * 24 * 30 },
};

export const SENTINEL2_CLOUDLESS_URL =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';

export class Sentinel2CloudlessBasemap implements MapTileProvider {
  readonly meta = SENTINEL2_CLOUDLESS_META;
  readonly detailLevel = 'regional' as const;
  descriptor(): BasemapDescriptor {
    return {
      kind: 'xyz',
      url: SENTINEL2_CLOUDLESS_URL,
      maxZoom: 14,
      attribution: this.meta.attribution,
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

export const NO_BUILDINGS_META: ProviderMeta = {
  id: 'no-buildings',
  name: 'No buildings',
  attribution: '',
  license: 'n/a',
  review: 'approved',
  isFixture: false,
  cache: { allowed: false, maxAgeSeconds: 0 },
};

export class NoBuildings implements BuildingsProvider {
  readonly meta = NO_BUILDINGS_META;
  descriptor(): BuildingsDescriptor {
    return { kind: 'none', attribution: '' };
  }
}

/**
 * OpenStreetMap buildings from OpenFreeMap's OpenMapTiles vector tiles: free, no key, no request
 * limit, commercial use allowed with attribution. Footprints with `render_height`, extruded on
 * the terrain by the renderer around where you stand.
 */
export const OPENFREEMAP_BUILDINGS_META: ProviderMeta = {
  id: 'openfreemap-buildings',
  name: 'OpenStreetMap buildings (OpenFreeMap vector tiles)',
  attribution: '© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  license: 'ODbL 1.0 (data); OpenFreeMap terms (tiles)',
  termsUrl: 'https://openfreemap.org',
  review: 'approved',
  isFixture: false,
  cache: { allowed: true, maxAgeSeconds: 60 * 60 * 24 * 7 },
};

export const OPENFREEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

export class OpenFreeMapBuildings implements BuildingsProvider {
  readonly meta = OPENFREEMAP_BUILDINGS_META;
  descriptor(): BuildingsDescriptor {
    return {
      kind: 'vector-tiles',
      url: OPENFREEMAP_TILEJSON_URL,
      attribution: this.meta.attribution,
    };
  }
}

/** Cesium OSM Buildings: OpenStreetMap building footprints and heights as 3D Tiles, via ion. */
export const CESIUM_OSM_BUILDINGS_ASSET_ID = 96188;

export const CESIUM_OSM_BUILDINGS_META: ProviderMeta = {
  id: 'cesium-osm-buildings',
  name: 'Cesium OSM Buildings',
  attribution:
    'Buildings © OpenStreetMap contributors (ODbL) · Cesium OSM Buildings via Cesium ion',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  license: 'ODbL 1.0 (data); Cesium ion terms (tiles)',
  termsUrl: 'https://cesium.com/legal/terms-of-service/',
  review: 'conditional',
  isFixture: false,
  cache: { allowed: false, maxAgeSeconds: 0 },
};

export class CesiumOsmBuildings implements BuildingsProvider {
  readonly meta = CESIUM_OSM_BUILDINGS_META;
  descriptor(): BuildingsDescriptor {
    return {
      kind: 'cesium-osm',
      assetId: CESIUM_OSM_BUILDINGS_ASSET_ID,
      attribution: this.meta.attribution,
    };
  }
}

export const NO_LAND_COVER_META: ProviderMeta = {
  id: 'no-land-cover',
  name: 'No land cover',
  attribution: '',
  license: 'n/a',
  review: 'approved',
  isFixture: false,
  cache: { allowed: false, maxAgeSeconds: 0 },
};

export class NoLandCover implements LandCoverProvider {
  readonly meta = NO_LAND_COVER_META;
  descriptor(): LandCoverDescriptor {
    return { kind: 'none', attribution: '' };
  }
}

/** The published legends the renderer can read (`@lightmap/renderer` `land-cover.ts`). */
export const LAND_COVER_PALETTES = ['worldcover', 'copernicus'] as const;
export type LandCoverPaletteName = (typeof LAND_COVER_PALETTES)[number];

/**
 * An operator-configured land-cover tile source: ESA WorldCover (10 m, CC BY 4.0) or the
 * Copernicus Global Land Cover (100 m, CC BY 4.0), rendered as XYZ tiles in the product's own
 * legend colours. The data licences allow commercial use with attribution; the tile host's
 * terms are the operator's to check (`DATA_SOURCES_AND_LICENSING.md`).
 */
export class XyzLandCover implements LandCoverProvider {
  readonly meta: ProviderMeta;
  private readonly opts: {
    url: string;
    attribution: string;
    maxZoom: number;
    palette: LandCoverPaletteName;
    termsUrl?: string;
  };
  constructor(opts: {
    url: string;
    attribution: string;
    maxZoom: number;
    palette: LandCoverPaletteName;
    termsUrl?: string;
  }) {
    this.opts = opts;
    this.meta = {
      id: 'xyz-land-cover',
      name:
        opts.palette === 'worldcover'
          ? 'ESA WorldCover land cover (operator-configured tiles)'
          : 'Copernicus Global Land Cover (operator-configured tiles)',
      attribution: opts.attribution,
      attributionUrl:
        opts.palette === 'worldcover'
          ? 'https://esa-worldcover.org/'
          : 'https://land.copernicus.eu/global/products/lc',
      license: 'CC BY 4.0 (data); tile host per operator',
      review: 'conditional',
      isFixture: false,
      cache: { allowed: false, maxAgeSeconds: 0 },
      ...(opts.termsUrl !== undefined ? { termsUrl: opts.termsUrl } : {}),
    };
  }
  descriptor(): LandCoverDescriptor {
    return {
      kind: 'xyz',
      url: this.opts.url,
      maxZoom: this.opts.maxZoom,
      palette: this.opts.palette,
      attribution: this.opts.attribution,
    };
  }
}

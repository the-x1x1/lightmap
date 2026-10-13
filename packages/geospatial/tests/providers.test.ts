import { describe, expect, it } from 'vitest';
import { parseEnv } from '@lightmap/config';
import {
  FixtureGeocoder,
  FixtureTimezoneProvider,
  etcZoneForLongitude,
} from '../src/providers/fixtures.ts';
import { NominatimGeocoder } from '../src/providers/nominatim.ts';
import { extractHeight } from '../src/providers/map-sources.ts';
import {
  activeAttributions,
  createGeospatialProviders,
  publicDescriptors,
} from '../src/providers/registry.ts';

const urlOf = (u: string | URL | Request): string =>
  typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;

describe('fixture providers', () => {
  it('finds Kailua and resolves its time zone', async () => {
    const g = new FixtureGeocoder();
    const hits = await g.search('kailua');
    expect(hits[0]?.label).toContain('Kailua');
    expect(g.meta.isFixture).toBe(true);
    const tz = await new FixtureTimezoneProvider().lookup(hits[0]!.point);
    expect(tz).toBe('Pacific/Honolulu');
  });
  it('falls back to nautical Etc zones over open ocean', async () => {
    expect(etcZoneForLongitude(-150)).toBe('Etc/GMT+10');
    expect(etcZoneForLongitude(150)).toBe('Etc/GMT-10');
    expect(etcZoneForLongitude(3)).toBe('Etc/UTC');
    expect(await new FixtureTimezoneProvider().lookup({ latitude: 0, longitude: -30 })).toBe(
      'Etc/GMT+2',
    );
  });
});

describe('Nominatim adapter', () => {
  it('normalises results and enforces the 1 req/s policy', async () => {
    let t = 1_000_000;
    const slept: number[] = [];
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(urlOf(url));
      expect((init?.headers as Record<string, string>)['User-Agent']).toContain('LightMap');
      return new Response(
        JSON.stringify([
          {
            place_id: 1,
            display_name: 'Kailua Beach Park, Kailua, Hawaii',
            lat: '21.397',
            lon: '-157.727',
            address: { country_code: 'us' },
            boundingbox: ['21.39', '21.40', '-157.73', '-157.72'],
          },
        ]),
        { status: 200 },
      );
    }) as typeof fetch;
    const g = new NominatimGeocoder({
      userAgent: 'LightMap-test',
      fetchImpl,
      now: () => t,
      sleep: async (ms) => {
        slept.push(ms);
        t += ms;
      },
    });
    const a = await g.search('Kailua Beach');
    expect(a[0]).toMatchObject({
      label: 'Kailua Beach Park, Kailua, Hawaii',
      countryCode: 'US',
      sourceId: 'nominatim:1',
    });
    expect(a[0]?.bounds?.north).toBe(21.4);
    t += 200;
    await g.search('Lanikai');
    expect(slept).toEqual([800]);
    expect(calls[0]).toContain('format=jsonv2');
  });
  it('puts the volcano ahead of the town named after it (prominence, natural features first)', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify([
          {
            place_id: 1,
            display_name: 'Mount Rainier, Maryland',
            lat: '38.94',
            lon: '-76.96',
            importance: 0.45,
            category: 'place',
          },
          {
            place_id: 2,
            display_name: 'Mount Rainier, Washington',
            lat: '46.85',
            lon: '-121.76',
            importance: 0.62,
            category: 'natural',
          },
          {
            place_id: 3,
            display_name: 'Mount Rainier National Park',
            lat: '46.88',
            lon: '-121.73',
            importance: 0.62,
            category: 'boundary',
          },
        ]),
        { status: 200 },
      )) as unknown as typeof fetch;
    const g = new NominatimGeocoder({ userAgent: 'LightMap-test', fetchImpl });
    const hits = await g.search('Mount Rainier');
    expect(hits.map((h) => h.sourceId)).toEqual(['nominatim:2', 'nominatim:3', 'nominatim:1']);
  });
  it('drops results without coordinates', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify([{ display_name: 'x' }]), {
        status: 200,
      })) as unknown as typeof fetch;
    const g = new NominatimGeocoder({ userAgent: 'LightMap-test', fetchImpl });
    expect(await g.search('anything')).toEqual([]);
  });
});

describe('registry', () => {
  it('picks live providers by default and never leaks credentials', () => {
    const env = parseEnv({ TERRAIN_PROVIDER: 'cesium-ion', CESIUM_ION_TOKEN: 'secret-token' }).env;
    const p = createGeospatialProviders(env);
    const pub = publicDescriptors(p);
    expect(pub.terrain.kind).toBe('cesium-ion');
    expect(JSON.stringify(pub)).not.toContain('secret-token');
    expect(pub.referenceImagery).toBe(false);
    expect(activeAttributions(p).map((m) => m.id)).toContain('natural-earth-ii');
  });
  it('buildings: none by default; Cesium OSM Buildings only with the ion token, attributed to OpenStreetMap', () => {
    const none = createGeospatialProviders(parseEnv({}).env);
    expect(publicDescriptors(none).buildings).toEqual({
      kind: 'none',
      attribution: '',
      providerId: 'no-buildings',
    });
    expect(activeAttributions(none).map((m) => m.id)).not.toContain('no-buildings');
    const withToken = createGeospatialProviders(
      parseEnv({ BUILDINGS_PROVIDER: 'cesium-osm', CESIUM_ION_TOKEN: 'secret-token' }).env,
    );
    const pub = publicDescriptors(withToken);
    expect(pub.buildings).toMatchObject({ kind: 'cesium-osm', assetId: 96188 });
    expect(pub.buildings.attribution).toContain('OpenStreetMap');
    expect(JSON.stringify(pub)).not.toContain('secret-token');
    expect(activeAttributions(withToken).map((m) => m.id)).toContain('cesium-osm-buildings');
    const noToken = createGeospatialProviders(parseEnv({ BUILDINGS_PROVIDER: 'cesium-osm' }).env);
    expect(noToken.buildings.meta.id).toBe('no-buildings');
  });

  it('land cover: none by default; an XYZ source only with its URL and attribution, in a known legend', () => {
    const none = createGeospatialProviders(parseEnv({}).env);
    expect(publicDescriptors(none).landCover).toEqual({
      kind: 'none',
      attribution: '',
      providerId: 'no-land-cover',
    });
    expect(activeAttributions(none).map((m) => m.id)).not.toContain('no-land-cover');
    const wc = createGeospatialProviders(
      parseEnv({
        LANDCOVER_PROVIDER: 'xyz',
        LANDCOVER_XYZ_URL: 'https://lc.example/{z}/{x}/{y}.png',
        LANDCOVER_XYZ_ATTRIBUTION:
          '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
        LANDCOVER_XYZ_MAX_ZOOM: '13',
      }).env,
    );
    const pub = publicDescriptors(wc);
    expect(pub.landCover).toEqual({
      kind: 'xyz',
      url: 'https://lc.example/{z}/{x}/{y}.png',
      maxZoom: 13,
      palette: 'worldcover',
      attribution:
        '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
      providerId: 'xyz-land-cover',
    });
    expect(activeAttributions(wc).map((m) => m.id)).toContain('xyz-land-cover');
    const cgls = createGeospatialProviders(
      parseEnv({
        LANDCOVER_PROVIDER: 'xyz',
        LANDCOVER_XYZ_URL: 'https://lc.example/{z}/{x}/{y}.png',
        LANDCOVER_XYZ_ATTRIBUTION: '© Copernicus Service information 2019',
        LANDCOVER_PALETTE: 'copernicus',
      }).env,
    );
    expect(publicDescriptors(cgls).landCover.palette).toBe('copernicus');
    expect(cgls.landCover.meta.name).toContain('Copernicus');
    // Missing attribution: the provider is refused and the env says why.
    const parsed = parseEnv({
      LANDCOVER_PROVIDER: 'xyz',
      LANDCOVER_XYZ_URL: 'https://lc.example/{z}/{x}/{y}.png',
    });
    expect(parsed.issues.map((i) => i.key)).toContain('LANDCOVER_XYZ_ATTRIBUTION');
    expect(createGeospatialProviders(parsed.env).landCover.meta.id).toBe('no-land-cover');
  });

  it('degrades to safe defaults when credentials are missing', () => {
    const env = parseEnv({
      TERRAIN_PROVIDER: 'cesium-ion',
      IMAGERY_PROVIDER: 'cesium-ion',
      GEOCODER_PROVIDER: 'fixture',
    }).env;
    const p = createGeospatialProviders(env);
    expect(p.terrain.meta.id).toBe('ellipsoid');
    expect(p.basemap.meta.id).toBe('natural-earth-ii');
    expect(p.geocoder.meta.isFixture).toBe(true);
  });
  it('reads heights from several response shapes', () => {
    expect(extractHeight(12.5)).toBe(12.5);
    expect(extractHeight({ height: 3 })).toBe(3);
    expect(extractHeight({ heights: [7] })).toBe(7);
    expect(extractHeight({ nope: 1 })).toBeNull();
  });
});

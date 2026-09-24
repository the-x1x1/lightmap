import { describe, expect, it } from 'vitest';
import { parseEnv } from '@lightmap/config';
import { FixtureGeocoder, FixtureTimezoneProvider, etcZoneForLongitude } from '../src/providers/fixtures.ts';
import { NominatimGeocoder } from '../src/providers/nominatim.ts';
import { extractHeight } from '../src/providers/map-sources.ts';
import { activeAttributions, createGeospatialProviders, publicDescriptors } from '../src/providers/registry.ts';

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
    expect(await new FixtureTimezoneProvider().lookup({ latitude: 0, longitude: -30 })).toBe('Etc/GMT+2');
  });
});

describe('Nominatim adapter', () => {
  it('normalises results and enforces the 1 req/s policy', async () => {
    let t = 1_000_000;
    const slept: number[] = [];
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect((init?.headers as Record<string, string>)['User-Agent']).toContain('LightMap');
      return new Response(JSON.stringify([{ place_id: 1, display_name: 'Kailua Beach Park, Kailua, Hawaii', lat: '21.397', lon: '-157.727', address: { country_code: 'us' }, boundingbox: ['21.39', '21.40', '-157.73', '-157.72'] }]), { status: 200 });
    }) as typeof fetch;
    const g = new NominatimGeocoder({ userAgent: 'LightMap-test', fetchImpl, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
    const a = await g.search('Kailua Beach');
    expect(a[0]).toMatchObject({ label: 'Kailua Beach Park, Kailua, Hawaii', countryCode: 'US', sourceId: 'nominatim:1' });
    expect(a[0]?.bounds?.north).toBe(21.4);
    t += 200;
    await g.search('Lanikai');
    expect(slept).toEqual([800]);
    expect(calls[0]).toContain('format=jsonv2');
  });
  it('drops results without coordinates', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify([{ display_name: 'x' }]), { status: 200 })) as unknown as typeof fetch;
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
  it('degrades to safe defaults when credentials are missing', () => {
    const env = parseEnv({ TERRAIN_PROVIDER: 'cesium-ion', IMAGERY_PROVIDER: 'cesium-ion', GEOCODER_PROVIDER: 'fixture' }).env;
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

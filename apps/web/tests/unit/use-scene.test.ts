import { describe, expect, it } from 'vitest';
import { environmentFromCapabilities } from '@/features/planner/use-scene';
import type { CapabilitiesResponse } from '@/lib/api-types';

const caps: CapabilitiesResponse = {
  providers: {
    terrain: {
      kind: 'quantized-mesh',
      url: 'https://t',
      attribution: 'T',
      providerId: 'reearth-mapterhorn-terrain',
      isFixture: false,
    },
    basemap: {
      kind: 'cesium-natural-earth',
      attribution: 'NE',
      providerId: 'natural-earth-ii',
      detailLevel: 'coarse',
      isFixture: false,
    },
    buildings: { kind: 'none', attribution: '', providerId: 'no-buildings' },
    geocoderId: 'nominatim',
    geocoderIsFixture: false,
    referenceImagery: false,
    attributions: [{ id: 'natural-earth-ii', attribution: 'NE' }],
  },
  weather: null,
  fixtureMode: true,
  devBanner: true,
  flags: {},
  billingConfigured: false,
  analytics: false,
  authMethods: { email: false, google: false, devLogin: false },
};

describe('environmentFromCapabilities', () => {
  it('maps provider descriptors to the environment state', () => {
    const env = environmentFromCapabilities(caps, 3);
    expect(env).toMatchObject({
      terrainAvailable: true,
      basemapDetail: 'coarse',
      groundElevationM: 3,
      fixtureMode: true,
    });
    expect(env.buildingsAvailable).toBe(false);
    expect(
      environmentFromCapabilities(
        {
          ...caps,
          providers: {
            ...caps.providers,
            buildings: {
              kind: 'cesium-osm',
              assetId: 96188,
              attribution: 'OSM',
              providerId: 'cesium-osm-buildings',
            },
          },
        },
        3,
      ).buildingsAvailable,
    ).toBe(true);
    expect(environmentFromCapabilities(null, null).terrainAvailable).toBe(false);
  });
});

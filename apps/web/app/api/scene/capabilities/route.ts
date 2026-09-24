import { publicDescriptors } from '@lightmap/geospatial';
import { json } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';
import type { CapabilitiesResponse } from '@/lib/api-types';

export const dynamic = 'force-dynamic';

/** What the client may render with: credential-free descriptors, provider attributions, flags. */
export async function GET() {
  const s = getServices();
  const providers = publicDescriptors(s.geo);
  const usesIon =
    providers.terrain.kind === 'cesium-ion' || providers.basemap.kind === 'cesium-ion';
  const body: CapabilitiesResponse = {
    providers,
    weather: s.weather.getCapabilities(),
    fixtureMode:
      s.capabilities.fixtureMode ||
      s.weather.getCapabilities().isFixture ||
      s.geo.geocoder.meta.isFixture,
    devBanner: s.env.LIGHTMAP_SHOW_DEV_BANNER,
    flags: { ...s.flags },
    billingConfigured: s.billing.configured,
    ...(usesIon && s.env.CESIUM_ION_TOKEN ? { ionToken: s.env.CESIUM_ION_TOKEN } : {}),
    authMethods: s.db ? s.authMethods : { email: false, google: false, devLogin: false },
  };
  return json(body, { headers: { 'Cache-Control': 'private, max-age=300' } });
}

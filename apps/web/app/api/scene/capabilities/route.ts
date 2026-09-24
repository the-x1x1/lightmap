import { publicDescriptors } from '@lightmap/geospatial';
import { json } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';
import type { CapabilitiesResponse } from '@/lib/api-types';

export const dynamic = 'force-dynamic';

/** What the client may render with: credential-free descriptors, provider attributions, flags. */
export async function GET() {
  const s = getServices();
  const body: CapabilitiesResponse = {
    providers: publicDescriptors(s.geo),
    weather: s.weather.getCapabilities(),
    fixtureMode: s.capabilities.fixtureMode || s.weather.getCapabilities().isFixture || s.geo.geocoder.meta.isFixture,
    devBanner: s.env.LIGHTMAP_SHOW_DEV_BANNER,
    flags: { ...s.flags },
    billingConfigured: s.billing.configured,
    authMethods: s.db ? s.authMethods : { email: false, google: false, devLogin: false },
  };
  return json(body, { headers: { 'Cache-Control': 'private, max-age=300' } });
}

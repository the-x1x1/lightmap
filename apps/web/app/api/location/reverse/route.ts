import { cacheRepo } from '@lightmap/database';
import { gridKey } from '@lightmap/geospatial';
import { errorResponse, json, num } from '@/lib/server/http';
import { checkBurst, clientKey } from '@/lib/server/rate-limit';
import { getServices } from '@/lib/server/services';
import { requestContext } from '@/lib/server/session';
import type { ReverseResponse } from '@/lib/api-types';

export const dynamic = 'force-dynamic';

/** Resolve place label + time zone + elevation for a clicked coordinate (plan §24 step 1). */
export async function GET(req: Request) {
  try {
    const s = getServices();
    const params = new URL(req.url).searchParams;
    const lat = num(params, 'lat', -90, 90);
    const lng = num(params, 'lng', -180, 180);
    const ctx = await requestContext();
    checkBurst(`reverse:${clientKey(req, ctx.user?.id ?? null)}`, 60);
    const point = { latitude: lat, longitude: lng };
    const cache = s.db ? cacheRepo(s.db.db) : null;
    const cacheKey = gridKey(point, 0.01);
    const cached = cache ? await cache.get<ReverseResponse>('reverse', cacheKey) : null;
    if (cached) return json(cached);

    const [timeZone, place, elevationM] = await Promise.all([
      s.geo.timezone.lookup(point),
      s.geo.geocoder.reverse(point).catch(() => null),
      s.geo.terrain.sampleElevation(point).catch(() => null),
    ]);
    const meta = s.geo.geocoder.meta;
    const body: ReverseResponse = { place, timeZone: timeZone ?? 'Etc/UTC', elevationM, provider: { id: meta.id, isFixture: meta.isFixture, attribution: meta.attribution } };
    if (cache) await cache.set('reverse', cacheKey, body, 60 * 60 * 24 * 30);
    return json(body);
  } catch (e) {
    return errorResponse(e);
  }
}

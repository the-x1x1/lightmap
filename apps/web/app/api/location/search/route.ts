import { parseCoordinates, type Place } from '@lightmap/geospatial';
import { cacheRepo } from '@lightmap/database';
import { errorResponse, json, str } from '@/lib/server/http';
import { chargeBudget, checkBurst, clientKey } from '@/lib/server/rate-limit';
import { getServices } from '@/lib/server/services';
import { requestContext } from '@/lib/server/session';
import type { LocationSearchResponse } from '@/lib/api-types';

export const dynamic = 'force-dynamic';

/** Find a known place or coordinate. Not a discovery engine (plan §0): one query → a few named places. */
export async function GET(req: Request) {
  try {
    const s = getServices();
    const params = new URL(req.url).searchParams;
    const q = str(params, 'q', { required: true, maxLength: 120 })!;
    const coords = parseCoordinates(q);
    const meta = s.geo.geocoder.meta;
    if (coords) {
      const body: LocationSearchResponse = {
        results: [
          {
            label: `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`,
            point: coords,
            sourceId: 'coordinates',
          },
        ],
        provider: { id: 'coordinates', isFixture: false, attribution: '' },
      };
      return json(body);
    }
    const ctx = await requestContext();
    const key = clientKey(req, ctx.user?.id ?? null);
    checkBurst(`search:${key}`, 30);
    const norm = q.toLowerCase().replace(/\s+/g, ' ').trim();
    const cache = s.db ? cacheRepo(s.db.db) : null;
    let results: Place[] | null = cache ? await cache.get<Place[]>('geocode', norm) : null;
    if (!results) {
      await chargeBudget(key, 'geocoder', ctx.planForBudget);
      results = await s.geo.geocoder.search(q, { limit: 6 });
      if (cache && meta.cache.allowed)
        await cache.set('geocode', norm, results, meta.cache.maxAgeSeconds);
    }
    const body: LocationSearchResponse = {
      results,
      provider: { id: meta.id, isFixture: meta.isFixture, attribution: meta.attribution },
    };
    return json(body);
  } catch (e) {
    return errorResponse(e);
  }
}

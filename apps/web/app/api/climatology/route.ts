import { isValidTimeZone } from '@lightmap/astronomy';
import { cacheRepo } from '@lightmap/database';
import { can } from '@lightmap/entitlements';
import {
  buildMonthlyClimatology,
  climatologyCacheKey,
  DAYLIGHT_WINDOW,
  type ClimatologySummary,
} from '@lightmap/weather';
import { HttpError, errorResponse, forbidByEntitlement, json, num, str } from '@/lib/server/http';
import { chargeBudget, checkBurst, clientKey } from '@/lib/server/rate-limit';
import { getServices } from '@/lib/server/services';
import { requestContext } from '@/lib/server/session';
import type { ClimatologyResponse } from '@/lib/api-types';

export const dynamic = 'force-dynamic';

const CACHE_TTL_S = 30 * 24 * 3600;

/**
 * "Typical for this month" (plan §25 Phase 7; WEATHER_AND_FORECAST_MODEL.md §8): a distribution of
 * the five scenario classes over the last ten complete years, daylight hours, for the 0.5° cell
 * around the pin. Never a forecast. Pro entitlement `climatology`; one summary costs up to ten
 * upstream archive requests, so it is cached for 30 days and budgeted per plan.
 */
export async function GET(req: Request) {
  const s = getServices();
  try {
    const params = new URL(req.url).searchParams;
    const lat = num(params, 'lat', -90, 90);
    const lng = num(params, 'lng', -180, 180);
    const month = num(params, 'month', 1, 12);
    if (!Number.isInteger(month)) throw new HttpError(400, 'bad_request', 'month must be 1–12');
    const tz = str(params, 'tz', { maxLength: 64 }) ?? 'Etc/UTC';
    if (!isValidTimeZone(tz))
      throw new HttpError(400, 'bad_request', 'tz must be an IANA time zone');

    const ctx = await requestContext();
    const decision = can(ctx.entitlements, 'climatology');
    if (!decision.allowed) throw forbidByEntitlement(decision);
    const key = clientKey(req, ctx.user?.id ?? null);
    checkBurst(`climatology:${key}`, 10);

    const caps = s.climatology.getCapabilities();
    const toYear = new Date().getUTCFullYear() - 1;
    const years = { from: Math.max(caps.earliestYear, toYear - caps.defaultYears + 1), to: toYear };
    // Cell centre so nearby pins share one upstream fetch (and one cache row).
    const clat = Math.round(lat * 2) / 2;
    const clng = Math.round(lng * 2) / 2;
    const cacheKey = climatologyCacheKey(
      caps.providerId,
      lat,
      lng,
      month,
      years,
      DAYLIGHT_WINDOW,
      tz,
    );
    const cache = s.db ? cacheRepo(s.db.db) : null;
    let summary = cache ? await cache.get<ClimatologySummary>('climatology', cacheKey) : null;
    const cached = summary !== null;
    if (!summary) {
      await chargeBudget(key, 'climatology', ctx.planForBudget);
      summary = await buildMonthlyClimatology(s.climatology, {
        latitude: clat,
        longitude: clng,
        month,
        timeZone: tz,
        toYear,
        years: caps.defaultYears,
        concurrency: 3,
      });
      if (cache) await cache.set('climatology', cacheKey, summary, CACHE_TTL_S);
    }
    const body: ClimatologyResponse = {
      summary,
      cached,
      isFixture: caps.isFixture,
    };
    return json(body, { headers: { 'Cache-Control': 'private, max-age=86400' } });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e);
    s.log.warn('climatology provider failed', { error: e });
    return errorResponse(
      new HttpError(
        502,
        'climatology_unavailable',
        'Typical conditions are unavailable right now. Scenarios still work.',
      ),
    );
  }
}

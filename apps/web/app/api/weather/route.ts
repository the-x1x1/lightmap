import { isValidTimeZone, localDayBounds, parseCivilDate } from '@lightmap/astronomy';
import { cacheRepo } from '@lightmap/database';
import { gridKey } from '@lightmap/geospatial';
import { decideWeatherMode, forecastCacheKey, type WeatherSeries } from '@lightmap/weather';
import { HttpError, errorResponse, json, num, str } from '@/lib/server/http';
import { chargeBudget, checkBurst, clientKey } from '@/lib/server/rate-limit';
import { getServices } from '@/lib/server/services';
import { requestContext } from '@/lib/server/session';
import type { WeatherResponse } from '@/lib/api-types';

export const dynamic = 'force-dynamic';

/**
 * One civil day of hourly frames for a grid cell (plan §19: "fetch a day's weather once, interpolate
 * locally"). Refuses to fetch beyond the provider horizon — the client already knows it is in
 * scenario mode and should not have asked.
 */
export async function GET(req: Request) {
  try {
    const s = getServices();
    const params = new URL(req.url).searchParams;
    const lat = num(params, 'lat', -90, 90);
    const lng = num(params, 'lng', -180, 180);
    const civil = parseCivilDate(
      str(params, 'date', { required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ })!,
    );
    if (!civil) throw new HttpError(400, 'bad_request', 'date must be a valid YYYY-MM-DD');
    const tz = str(params, 'tz', { maxLength: 64 }) ?? 'Etc/UTC';
    if (!isValidTimeZone(tz))
      throw new HttpError(400, 'bad_request', 'tz must be an IANA time zone');
    const { start, end } = localDayBounds(civil, tz);
    const caps = s.weather.getCapabilities();
    const decision = decideWeatherMode(
      new Date((start.getTime() + end.getTime()) / 2),
      new Date(),
      caps,
    );
    if (!decision.fetchWorthwhile) throw new HttpError(422, 'outside_horizon', decision.reason);

    const ctx = await requestContext();
    const key = clientKey(req, ctx.user?.id ?? null);
    checkBurst(`weather:${key}`, 30);
    const cell = gridKey({ latitude: lat, longitude: lng });
    const cacheKey = forecastCacheKey(
      caps.providerId,
      cell,
      `${civil.year}-${String(civil.month).padStart(2, '0')}-${String(civil.day).padStart(2, '0')}`,
    );
    const cache = s.db ? cacheRepo(s.db.db) : null;
    let series = cache ? await cache.get<WeatherSeries>('weather', cacheKey) : null;
    const cached = series !== null;
    if (!series) {
      await chargeBudget(key, 'weather', ctx.planForBudget);
      const [clat, clng] = cell.split(',').map(Number) as [number, number];
      series =
        decision.mode === 'RECENT_PAST'
          ? await s.weather.getHistorical(clat, clng, start, end)
          : await s.weather.getForecast(clat, clng, start, end);
      const ttl = decision.mode === 'RECENT_PAST' ? 6 * 3600 : caps.updateIntervalMinutes * 60;
      if (cache) await cache.set('weather', cacheKey, series, ttl);
    }
    const body: WeatherResponse = {
      providerId: series.providerId,
      mode: decision.mode,
      frames: series.frames,
      issuedAt: series.issuedAt,
      fetchedAt: series.fetchedAt,
      cached,
      attribution: caps.attribution,
    };
    return json(body, { headers: { 'Cache-Control': 'private, max-age=900' } });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e);
    // Provider failure resolves to a usable state client-side (plan §34): 502 with a clear code.
    getServices().log.warn('weather provider failed', { error: e });
    return errorResponse(
      new HttpError(
        502,
        'weather_unavailable',
        'Live forecast unavailable right now — showing your selected scenario.',
      ),
    );
  }
}

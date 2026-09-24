import { astronomy, isValidTimeZone, parseCivilDate } from '@lightmap/astronomy';
import { HttpError, errorResponse, json, num, str } from '@/lib/server/http';
import type { SolarDayResponse } from '@/lib/api-types';

export const dynamic = 'force-dynamic';

/** Day events for a place and civil date. The client computes these too; this exists for integrations and tests. */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const lat = num(params, 'lat', -90, 90);
    const lng = num(params, 'lng', -180, 180);
    const date = parseCivilDate(
      str(params, 'date', { required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ })!,
    );
    if (!date) throw new HttpError(400, 'bad_request', 'date must be a valid YYYY-MM-DD');
    const tz = str(params, 'tz', { maxLength: 64 }) ?? 'Etc/UTC';
    if (!isValidTimeZone(tz))
      throw new HttpError(400, 'bad_request', 'tz must be an IANA time zone');
    const ev = astronomy.getDayEvents({ latitude: lat, longitude: lng, date, timeZone: tz });
    const events: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(ev))
      if (v instanceof Date || v === null) events[k] = v ? v.toISOString() : null;
    const body: SolarDayResponse = {
      date: ev.date,
      timeZone: ev.timeZone,
      events,
      polar: ev.polar,
      notes: ev.notes,
      daylightMinutes: ev.daylightMinutes,
    };
    return json(body, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  } catch (e) {
    return errorResponse(e);
  }
}

import { errorResponse, HttpError, requireSameOrigin } from '@/lib/server/http';
import { checkBurst, clientKey } from '@/lib/server/rate-limit';
import { getServices } from '@/lib/server/services';
import {
  MAX_ANALYTICS_BODY_BYTES,
  parseAnalyticsBeacon,
  type AnalyticsBeacon,
} from '@/lib/analytics-event';

export const dynamic = 'force-dynamic';

const NO_CONTENT = () => new Response(null, { status: 204 });

/**
 * Product analytics beacon (plan §31, docs/PRIVACY.md §4). Same-origin only; a fixed event set
 * with a fixed property list per event, enforced here whatever the client sent; nothing
 * identifies the visitor (no user id, no cookie read; the burst limiter's key is the usual salted
 * hash). Honours the browser's Do-Not-Track and Global Privacy Control signals, and is a no-op
 * when the operator has no sink configured — the client checks the same flag and sends nothing.
 */
export async function POST(req: Request) {
  try {
    const s = getServices();
    if (s.env.ANALYTICS_SINK === 'none') return NO_CONTENT();
    if (req.headers.get('dnt') === '1' || req.headers.get('sec-gpc') === '1') return NO_CONTENT();
    requireSameOrigin(req);
    checkBurst(`analytics:${clientKey(req, null)}`, 60);
    // The size check is on the body itself, not a header the sender controls.
    const text = await req.text();
    if (text.length > MAX_ANALYTICS_BODY_BYTES)
      throw new HttpError(413, 'too_large', 'Analytics beacon too large');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'bad_request', 'Body must be JSON');
    }
    let beacon: AnalyticsBeacon;
    try {
      beacon = parseAnalyticsBeacon(body);
    } catch (e) {
      throw new HttpError(400, 'bad_request', e instanceof Error ? e.message : 'Invalid beacon');
    }
    s.analytics.track(beacon.event, beacon.props);
    return NO_CONTENT();
  } catch (e) {
    return errorResponse(e);
  }
}

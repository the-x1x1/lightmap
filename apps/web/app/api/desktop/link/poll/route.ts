import { auditRepo, devicesRepo } from '@lightmap/database';
import { HttpError, errorResponse, json, readJson } from '@/lib/server/http';
import { requireDb } from '@/lib/server/session';
import { checkBurst, clientKey } from '@/lib/server/rate-limit';
import { DEVICE_TOKEN_PREFIX, newSecret, sha256 } from '@/lib/server/device-auth';

export const dynamic = 'force-dynamic';

/**
 * The app's poll with its secret: `pending` until the code is approved, then the device token,
 * once. An unknown, expired or spent link is 410.
 */
export async function POST(req: Request) {
  try {
    // The app polls every 3 s; a guesser would need far more than this.
    checkBurst(`desktop-poll:${clientKey(req, null)}`, 40);
    const { pollSecret } = await readJson(req, (b) => {
      const s = (b as Record<string, unknown> | null)?.['pollSecret'];
      if (typeof s !== 'string' || s.length < 20 || s.length > 200) throw new Error('pollSecret');
      return { pollSecret: s };
    });
    const db = requireDb();
    const token = newSecret(DEVICE_TOKEN_PREFIX);
    const r = await devicesRepo(db).consume(sha256(pollSecret), sha256(token));
    if (r.state === 'gone')
      throw new HttpError(410, 'link_gone', 'This sign-in has expired. Start it again.');
    if (r.state === 'pending')
      return json({ state: 'pending' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    await auditRepo(db).record('device.linked', r.userId, { tokenId: r.tokenId });
    return json({ state: 'linked', token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}

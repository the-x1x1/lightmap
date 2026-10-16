import { auditRepo, devicesRepo } from '@lightmap/database';
import { HttpError, errorResponse, json, readJson } from '@/lib/server/http';
import { requireBrowserUser, requireDb } from '@/lib/server/session';
import { checkBurst, clientKey } from '@/lib/server/rate-limit';
import { networkKey, normaliseLinkCode, sameNetwork } from '@/lib/server/device-auth';
import { getServices } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/** The signed-in person approves a desktop app's code (same-origin only, as every mutation). */
export async function POST(req: Request) {
  try {
    const ctx = await requireBrowserUser();
    checkBurst(`desktop-approve:${clientKey(req, ctx.user.id)}`, 10);
    const { code, typed } = await readJson(req, (b) => {
      const body = b as Record<string, unknown> | null;
      const raw = body?.['code'];
      const c = normaliseLinkCode(typeof raw === 'string' ? raw : '');
      if (!c) throw new Error('code is not a sign-in code');
      const t = body?.['typedCode'];
      return { code: c, typed: normaliseLinkCode(typeof t === 'string' ? t : '') };
    });
    const db = requireDb();
    // A link that came from another network is approved only with the code
    // typed from the app: a sign-in link sent to someone (device-code phishing) cannot be.
    const link = await devicesRepo(db).linkByCode(code);
    const here = networkKey(req, getServices().env.AUTH_SECRET ?? 'lightmap-anon');
    if (link && !sameNetwork(link.requestNet, here) && typed !== code)
      throw new HttpError(
        403,
        'code_not_typed',
        'Type the code the LightMap app on your computer shows to approve it.',
      );
    const ok = await devicesRepo(db).approve(code, ctx.user.id);
    if (!ok)
      throw new HttpError(
        409,
        'link_unavailable',
        'That code has expired or was already used. Start the sign-in again in the app.',
      );
    await auditRepo(db).record('device.link_approved', ctx.user.id, {});
    return json({ approved: true });
  } catch (e) {
    return errorResponse(e);
  }
}

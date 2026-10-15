import { auditRepo, devicesRepo } from '@lightmap/database';
import { HttpError, errorResponse, json, readJson } from '@/lib/server/http';
import { requireBrowserUser, requireDb } from '@/lib/server/session';
import { checkBurst, clientKey } from '@/lib/server/rate-limit';
import { normaliseLinkCode } from '@/lib/server/device-auth';

export const dynamic = 'force-dynamic';

/** The signed-in person approves a desktop app's code (same-origin only, as every mutation). */
export async function POST(req: Request) {
  try {
    const ctx = await requireBrowserUser();
    checkBurst(`desktop-approve:${clientKey(req, ctx.user.id)}`, 10);
    const { code } = await readJson(req, (b) => {
      const raw = (b as Record<string, unknown> | null)?.['code'];
      const c = normaliseLinkCode(typeof raw === 'string' ? raw : '');
      if (!c) throw new Error('code is not a sign-in code');
      return { code: c };
    });
    const db = requireDb();
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

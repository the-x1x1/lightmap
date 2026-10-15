import { auditRepo, devicesRepo } from '@lightmap/database';
import { HttpError, errorResponse, json, requireSameOrigin } from '@/lib/server/http';
import { requireBrowserUser, requireDb, requireUser } from '@/lib/server/session';
import { forwardToAccountOrigin } from '@/lib/server/account-proxy';

export const dynamic = 'force-dynamic';

/** The desktop apps signed in to this account. */
export async function GET(req: Request) {
  const forwarded = await forwardToAccountOrigin(req);
  if (forwarded) return forwarded;
  try {
    const ctx = await requireUser();
    const devices = await devicesRepo(requireDb()).list(ctx.user.id);
    return json(
      {
        devices: devices.map((d) => ({
          id: d.id,
          deviceName: d.deviceName,
          createdAt: d.createdAt.toISOString(),
          lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/** Signs a desktop app out from the account (`?id=`). */
export async function DELETE(req: Request) {
  const forwarded = await forwardToAccountOrigin(req);
  if (forwarded) return forwarded;
  try {
    requireSameOrigin(req);
    const ctx = await requireBrowserUser();
    const id = new URL(req.url).searchParams.get('id') ?? '';
    const db = requireDb();
    if (!(await devicesRepo(db).revoke(ctx.user.id, id)))
      throw new HttpError(404, 'not_found', 'No such device on this account.');
    await auditRepo(db).record('device.revoked', ctx.user.id, { tokenId: id });
    return json({ revoked: true });
  } catch (e) {
    return errorResponse(e);
  }
}

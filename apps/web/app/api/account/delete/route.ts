import { auditRepo, devicesRepo, usersRepo } from '@lightmap/database';
import { errorResponse, json, requireSameOrigin } from '@/lib/server/http';
import { requireDb, requireUser } from '@/lib/server/session';
import { forwardToAccountOrigin } from '@/lib/server/account-proxy';

export const dynamic = 'force-dynamic';

/**
 * Account deletion request (plan §16, §30). Marks the account; data is erased by the retention job
 * after 14 days (docs/PRIVACY.md) so an accidental request can be reversed by signing in again.
 */
export async function POST(req: Request) {
  const forwarded = await forwardToAccountOrigin(req);
  if (forwarded) return forwarded;
  try {
    requireSameOrigin(req);
    const ctx = await requireUser();
    const db = requireDb();
    await usersRepo(db).requestDeletion(ctx.user.id);
    // The desktop apps signed in to it are signed out; signing in again starts from the website.
    await devicesRepo(db).revokeAll(ctx.user.id);
    await auditRepo(db).record('account.deletion_requested', ctx.user.id);
    return json({ ok: true, erasesAfterDays: 14 });
  } catch (e) {
    return errorResponse(e);
  }
}

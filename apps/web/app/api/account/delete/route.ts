import { auditRepo, usersRepo } from '@lightmap/database';
import { errorResponse, json } from '@/lib/server/http';
import { requireDb, requireUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * Account deletion request (plan §16, §30). Marks the account; data is erased by the retention job
 * after 14 days (docs/PRIVACY.md) so an accidental request can be reversed by signing in again.
 */
export async function POST() {
  try {
    const ctx = await requireUser();
    const db = requireDb();
    await usersRepo(db).requestDeletion(ctx.user.id);
    await auditRepo(db).record('account.deletion_requested', ctx.user.id);
    return json({ ok: true, erasesAfterDays: 14 });
  } catch (e) {
    return errorResponse(e);
  }
}

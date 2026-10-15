import { auditRepo, devicesRepo } from '@lightmap/database';
import { headers } from 'next/headers';
import { HttpError, errorResponse, json } from '@/lib/server/http';
import { requireDb } from '@/lib/server/session';
import { bearerDeviceToken, sha256 } from '@/lib/server/device-auth';

export const dynamic = 'force-dynamic';

/** A desktop app signs out: its own token (the bearer) is revoked. */
export async function DELETE() {
  try {
    const token = bearerDeviceToken((await headers()).get('authorization'));
    if (!token) throw new HttpError(401, 'unauthenticated', 'No device token.');
    const db = requireDb();
    const owner = await devicesRepo(db).userForToken(sha256(token));
    if (owner) {
      await devicesRepo(db).revoke(owner.userId, owner.tokenId);
      await auditRepo(db).record('device.signed_out', owner.userId, { tokenId: owner.tokenId });
    }
    return json({ revoked: Boolean(owner) });
  } catch (e) {
    return errorResponse(e);
  }
}

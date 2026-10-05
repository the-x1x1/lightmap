import { profilesRepo } from '@lightmap/database';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { requireDb, requireUser } from '@/lib/server/session';
import { parsePreferencesPatch } from '@/lib/preferences';
import type { ProfileResponse } from '@/lib/api-types';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

/** The signed-in user's preferences (plan §17). Defaults when nothing has been changed yet. */
export async function GET() {
  try {
    const ctx = await requireUser();
    const body: ProfileResponse = await profilesRepo(requireDb()).get(ctx.user.id);
    return json(body, NO_STORE);
  } catch (e) {
    return errorResponse(e);
  }
}

/** Change any subset of the preferences; answers with the whole, updated set. */
export async function PATCH(req: Request) {
  try {
    const ctx = await requireUser();
    const patch = await readJson(req, parsePreferencesPatch);
    const body: ProfileResponse = {
      ...(await profilesRepo(requireDb()).update(ctx.user.id, patch)),
      customized: true,
    };
    return json(body, NO_STORE);
  } catch (e) {
    return errorResponse(e);
  }
}

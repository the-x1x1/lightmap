import { auditRepo, viewpointsRepo } from '@lightmap/database';
import { can } from '@lightmap/entitlements';
import { civilDateString, utcToWallClock } from '@lightmap/astronomy';
import {
  errorResponse,
  forbidByEntitlement,
  json,
  readJson,
  requireSameOrigin,
} from '@/lib/server/http';
import { requireDb, requireUser } from '@/lib/server/session';
import { viewpointDto } from '@/lib/server/dto';
import { parseViewpoint } from '@/lib/server/viewpoint-input';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const ctx = await requireUser();
    const { id } = await params;
    const vp = await viewpointsRepo(requireDb()).get(ctx.user.id, id);
    return json({ viewpoint: viewpointDto(vp) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const ctx = await requireUser();
    const { id } = await params;
    const { input, snapshot } = await readJson(req, (b) => parseViewpoint(b, 'patch'));
    const repo = viewpointsRepo(requireDb());
    if (input.selectedDatetimeUtc) {
      // The free-plan date window applies to edits too, evaluated in the viewpoint's own zone.
      const existing = await repo.get(ctx.user.id, id);
      const tz = input.timezone ?? existing.timezone;
      const decision = can(ctx.entitlements, 'future_date_planning', {
        targetDate: civilDateString(utcToWallClock(input.selectedDatetimeUtc, tz)),
        today: civilDateString(utcToWallClock(new Date(), tz)),
      });
      if (!decision.allowed) throw forbidByEntitlement(decision);
    }
    const vp = await repo.update(ctx.user.id, id, input, snapshot);
    return json({ viewpoint: viewpointDto(vp) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    requireSameOrigin(req);
    const ctx = await requireUser();
    const db = requireDb();
    const { id } = await params;
    await viewpointsRepo(db).remove(ctx.user.id, id);
    await auditRepo(db).record('viewpoint.deleted', ctx.user.id, { viewpointId: id });
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}

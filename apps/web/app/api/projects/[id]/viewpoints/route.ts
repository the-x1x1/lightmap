import { can } from '@lightmap/entitlements';
import { auditRepo, viewpointsRepo, type ViewpointInput } from '@lightmap/database';
import { HttpError, errorResponse, forbidByEntitlement, json, readJson } from '@/lib/server/http';
import { requireDb, requireUser } from '@/lib/server/session';
import { viewpointDto } from '@/lib/server/dto';
import { parseViewpoint } from '@/lib/server/viewpoint-input';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await requireUser();
    const db = requireDb();
    const { id: projectId } = await params;
    const repo = viewpointsRepo(db);
    const [inProject, total] = await Promise.all([
      repo.countInProject(ctx.user.id, projectId),
      repo.countTotal(ctx.user.id),
    ]);
    const decision = can(ctx.entitlements, 'saved_viewpoints', {
      viewpointCountInProject: inProject,
      viewpointCountTotal: total,
    });
    if (!decision.allowed) throw forbidByEntitlement(decision);
    const { input, snapshot } = await readJson(req, (b) => parseViewpoint(b, 'create'));
    // Free users may only save dates inside their planning window (plan §38: the paid value is future dates).
    const civil = input.selectedDatetimeUtc!.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const dateDecision = can(ctx.entitlements, 'future_date_planning', {
      targetDate: civil,
      today,
    });
    if (!dateDecision.allowed) throw forbidByEntitlement(dateDecision);
    if (!isComplete(input)) throw new HttpError(400, 'bad_request', 'Missing viewpoint fields');
    const vp = await repo.create(ctx.user.id, projectId, input, snapshot);
    await auditRepo(db).record('viewpoint.saved', ctx.user.id, { viewpointId: vp.id, projectId });
    return json(
      {
        viewpoint: viewpointDto({
          ...vp,
          snapshot: snapshot ? { thumbnailDataUrl: snapshot.thumbnailDataUrl ?? null } : null,
        }),
      },
      { status: 201 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

function isComplete(i: Partial<ViewpointInput>): i is ViewpointInput {
  return [
    'label',
    'latitude',
    'longitude',
    'timezone',
    'headingDeg',
    'pitchDeg',
    'fieldOfViewDeg',
    'selectedDatetimeUtc',
    'weatherMode',
    'previewSourceType',
  ].every((k) => (i as Record<string, unknown>)[k] !== undefined);
}

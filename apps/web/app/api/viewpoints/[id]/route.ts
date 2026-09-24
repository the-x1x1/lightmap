import { auditRepo, viewpointsRepo } from '@lightmap/database';
import { errorResponse, json, readJson } from '@/lib/server/http';
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
    const vp = await viewpointsRepo(requireDb()).update(ctx.user.id, id, input, snapshot);
    return json({ viewpoint: viewpointDto(vp) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
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

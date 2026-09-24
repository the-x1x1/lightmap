import { auditRepo, projectsRepo } from '@lightmap/database';
import { errorResponse, json, readJson, v } from '@/lib/server/http';
import { requireDb, requireUser } from '@/lib/server/session';
import { projectDto, viewpointDto } from '@/lib/server/dto';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const ctx = await requireUser();
    const { id } = await params;
    const p = await projectsRepo(requireDb()).get(ctx.user.id, id);
    return json({ project: { ...projectDto({ ...p, viewpointCount: p.viewpoints.length }), viewpoints: p.viewpoints.map((vp) => viewpointDto(vp)) } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const ctx = await requireUser();
    const { id } = await params;
    const patch = await readJson(req, (b) => {
      const o = v.obj(b);
      const out: { name?: string; description?: string | null; shootDate?: string | null } = {};
      const name = v.string(o['name'], 'name', { min: 1, max: 120, optional: true });
      if (name) out.name = name;
      const description = v.string(o['description'], 'description', { optional: true, nullable: true, max: 2000 });
      if (description !== undefined) out.description = description;
      const shootDate = v.isoDate(o['shootDate'], 'shootDate', { optional: true, nullable: true });
      if (shootDate !== undefined) out.shootDate = shootDate;
      return out;
    });
    const p = await projectsRepo(requireDb()).update(ctx.user.id, id, patch);
    return json({ project: projectDto(p) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const ctx = await requireUser();
    const db = requireDb();
    const { id } = await params;
    await projectsRepo(db).remove(ctx.user.id, id);
    await auditRepo(db).record('project.deleted', ctx.user.id, { projectId: id });
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}

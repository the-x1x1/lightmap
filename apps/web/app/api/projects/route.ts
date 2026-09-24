import { can } from '@lightmap/entitlements';
import { auditRepo, projectsRepo } from '@lightmap/database';
import { errorResponse, forbidByEntitlement, json, readJson, v } from '@/lib/server/http';
import { requireDb, requireUser } from '@/lib/server/session';
import { projectDto } from '@/lib/server/dto';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireUser();
    const list = await projectsRepo(requireDb()).list(ctx.user.id);
    return json({ projects: list.map(projectDto) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireUser();
    const db = requireDb();
    const repo = projectsRepo(db);
    const decision = can(ctx.entitlements, 'saved_projects', {
      projectCount: await repo.count(ctx.user.id),
    });
    if (!decision.allowed) throw forbidByEntitlement(decision);
    const body = await readJson(req, (b) => {
      const o = v.obj(b);
      return {
        name: v.string(o['name'], 'name', { min: 1, max: 120 })!,
        description:
          v.string(o['description'], 'description', {
            optional: true,
            nullable: true,
            max: 2000,
          }) ?? null,
        shootDate:
          v.isoDate(o['shootDate'], 'shootDate', { optional: true, nullable: true }) ?? null,
      };
    });
    const project = await repo.create(ctx.user.id, body);
    await auditRepo(db).record('project.created', ctx.user.id, { projectId: project.id });
    return json({ project: projectDto(project) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

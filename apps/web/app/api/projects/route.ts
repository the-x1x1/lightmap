import { can } from '@lightmap/entitlements';
import { auditRepo, projectsRepo } from '@lightmap/database';
import { errorResponse, forbidByEntitlement, json, readJson, v } from '@/lib/server/http';
import { requireDb, requireUser } from '@/lib/server/session';
import { getServices } from '@/lib/server/services';
import { projectDto } from '@/lib/server/dto';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const ctx = await requireUser();
    // `?archived=1` lists the archived projects instead of the active ones.
    const archived = new URL(req.url).searchParams.get('archived') === '1';
    // "Return later as the shoot approaches": count the viewpoints a forecast now covers.
    const now = new Date();
    const horizonHours = getServices().weather.getCapabilities().reliableHorizonHours;
    const list = await projectsRepo(requireDb()).list(
      ctx.user.id,
      { from: now, to: new Date(now.getTime() + horizonHours * 3_600_000) },
      { archived },
    );
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

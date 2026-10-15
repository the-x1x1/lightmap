import { auditRepo, projectsRepo, viewpointsRepo } from '@lightmap/database';
import { can } from '@lightmap/entitlements';
import {
  errorResponse,
  forbidByEntitlement,
  json,
  readJson,
  requireSameOrigin,
  v,
} from '@/lib/server/http';
import { requireDb, requireUser } from '@/lib/server/session';
import { projectDto, viewpointDto } from '@/lib/server/dto';
import { forwardToAccountOrigin } from '@/lib/server/account-proxy';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const forwarded = await forwardToAccountOrigin(req);
  if (forwarded) return forwarded;
  try {
    const ctx = await requireUser();
    const { id } = await params;
    const p = await projectsRepo(requireDb()).get(ctx.user.id, id);
    return json({
      project: {
        ...projectDto({ ...p, viewpointCount: p.viewpoints.length }),
        viewpoints: p.viewpoints.map((vp) => viewpointDto(vp)),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const forwarded = await forwardToAccountOrigin(req);
  if (forwarded) return forwarded;
  try {
    const ctx = await requireUser();
    const { id } = await params;
    const patch = await readJson(req, (b) => {
      const o = v.obj(b);
      const out: {
        name?: string;
        description?: string | null;
        shootDate?: string | null;
        archived?: boolean;
      } = {};
      const name = v.string(o['name'], 'name', { min: 1, max: 120, optional: true });
      if (name) out.name = name;
      const description = v.string(o['description'], 'description', {
        optional: true,
        nullable: true,
        max: 2000,
      });
      if (description !== undefined) out.description = description;
      const shootDate = v.isoDate(o['shootDate'], 'shootDate', { optional: true, nullable: true });
      if (shootDate !== undefined) out.shootDate = shootDate;
      if (o['archived'] !== undefined) {
        if (typeof o['archived'] !== 'boolean') throw new Error('archived must be a boolean');
        out.archived = o['archived'];
      }
      return out;
    });
    const db = requireDb();
    // Restoring brings a project's viewpoints back under the plan's limits. An archived project
    // already counts toward the project limit, so restoring one is refused only when the account
    // holds more projects than its plan allows (a Pro that lapsed to Free with ten, say).
    if (patch.archived === false) {
      const [saved, shelved, activeViewpoints] = await Promise.all([
        projectsRepo(db).count(ctx.user.id),
        projectsRepo(db).get(ctx.user.id, id),
        viewpointsRepo(db).countTotal(ctx.user.id),
      ]);
      if (shelved.archivedAt) {
        const projectDecision = can(ctx.entitlements, 'saved_projects', {
          projectCount: saved - 1,
        });
        if (!projectDecision.allowed) throw forbidByEntitlement(projectDecision);
        const n = shelved.viewpoints.length;
        if (n > 0) {
          // "Would the restored viewpoints fit?": the counts as they stand once all but one are in.
          const viewpointDecision = can(ctx.entitlements, 'saved_viewpoints', {
            viewpointCountInProject: n - 1,
            viewpointCountTotal: activeViewpoints + n - 1,
          });
          if (!viewpointDecision.allowed) throw forbidByEntitlement(viewpointDecision);
        }
      }
    }
    const p = await projectsRepo(db).update(ctx.user.id, id, patch);
    if (patch.archived !== undefined)
      await auditRepo(db).record(
        patch.archived ? 'project.archived' : 'project.restored',
        ctx.user.id,
        {
          projectId: id,
        },
      );
    return json({ project: projectDto(p) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const forwarded = await forwardToAccountOrigin(req);
  if (forwarded) return forwarded;
  try {
    requireSameOrigin(req);
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

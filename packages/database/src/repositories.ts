/**
 * Repositories: every read and write is scoped by the acting user (plan §29 "A user must never be
 * able to access another user's project by changing an ID"). Ownership is a WHERE clause here,
 * not a check the API route might forget.
 */
import { and, asc, count, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { ulid } from './ids.ts';
import {
  auditEvents,
  previewSnapshots,
  projects,
  providerCache,
  subscriptionEvents,
  subscriptions,
  usageCounters,
  users,
  viewpoints,
  type NewProject,
  type NewViewpoint,
  type Project,
  type Subscription,
  type Viewpoint,
} from './schema.ts';

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  shootDate?: string | null;
}

export function projectsRepo(db: Db) {
  return {
    async list(userId: string): Promise<Array<Project & { viewpointCount: number }>> {
      const rows = await db
        .select({ project: projects, viewpointCount: count(viewpoints.id) })
        .from(projects)
        .leftJoin(viewpoints, eq(viewpoints.projectId, projects.id))
        .where(and(eq(projects.userId, userId), isNull(projects.archivedAt)))
        .groupBy(projects.id)
        .orderBy(desc(projects.updatedAt));
      return rows.map((r) => ({ ...r.project, viewpointCount: Number(r.viewpointCount) }));
    },
    async count(userId: string): Promise<number> {
      const [r] = await db
        .select({ n: count() })
        .from(projects)
        .where(and(eq(projects.userId, userId), isNull(projects.archivedAt)));
      return Number(r?.n ?? 0);
    },
    async get(
      userId: string,
      id: string,
    ): Promise<
      Project & {
        viewpoints: Array<Viewpoint & { snapshot: { thumbnailDataUrl: string | null } | null }>;
      }
    > {
      const [p] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.userId, userId)))
        .limit(1);
      if (!p) throw new NotFoundError('project not found');
      const vps = await db
        .select()
        .from(viewpoints)
        .where(and(eq(viewpoints.projectId, id), eq(viewpoints.userId, userId)))
        .orderBy(asc(viewpoints.createdAt));
      // Newest thumbnail per viewpoint (one row is kept per viewpoint, see saveSnapshot).
      const ids = vps.map((v) => v.id);
      const snaps =
        ids.length === 0
          ? []
          : await db
              .select({
                viewpointId: previewSnapshots.viewpointId,
                thumbnailDataUrl: previewSnapshots.thumbnailDataUrl,
              })
              .from(previewSnapshots)
              .where(inArray(previewSnapshots.viewpointId, ids));
      const byId = new Map(
        snaps.map((x) => [x.viewpointId, { thumbnailDataUrl: x.thumbnailDataUrl }]),
      );
      return { ...p, viewpoints: vps.map((v) => ({ ...v, snapshot: byId.get(v.id) ?? null })) };
    },
    async create(userId: string, input: ProjectInput): Promise<Project> {
      const row: NewProject = {
        id: ulid(),
        userId,
        name: input.name.trim(),
        description: input.description ?? null,
        shootDate: input.shootDate ?? null,
      };
      const [p] = await db.insert(projects).values(row).returning();
      return p!;
    },
    async update(userId: string, id: string, patch: Partial<ProjectInput>): Promise<Project> {
      const [p] = await db
        .update(projects)
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.shootDate !== undefined ? { shootDate: patch.shootDate } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(projects.id, id), eq(projects.userId, userId)))
        .returning();
      if (!p) throw new NotFoundError('project not found');
      return p;
    },
    async remove(userId: string, id: string): Promise<void> {
      const res = await db
        .delete(projects)
        .where(and(eq(projects.id, id), eq(projects.userId, userId)))
        .returning({ id: projects.id });
      if (res.length === 0) throw new NotFoundError('project not found');
    },
  };
}

export type ViewpointInput = Omit<
  NewViewpoint,
  'id' | 'userId' | 'projectId' | 'createdAt' | 'updatedAt'
>;

export interface SnapshotInput {
  sourceType: string;
  providerMetadata: unknown;
  astronomyState: unknown;
  weatherState: unknown;
  confidenceState: unknown;
  thumbnailDataUrl?: string | null;
}

export function viewpointsRepo(db: Db) {
  return {
    async countInProject(userId: string, projectId: string): Promise<number> {
      const [r] = await db
        .select({ n: count() })
        .from(viewpoints)
        .where(and(eq(viewpoints.projectId, projectId), eq(viewpoints.userId, userId)));
      return Number(r?.n ?? 0);
    },
    async countTotal(userId: string): Promise<number> {
      const [r] = await db
        .select({ n: count() })
        .from(viewpoints)
        .where(eq(viewpoints.userId, userId));
      return Number(r?.n ?? 0);
    },
    async get(
      userId: string,
      id: string,
    ): Promise<Viewpoint & { snapshot: typeof previewSnapshots.$inferSelect | null }> {
      const [v] = await db
        .select()
        .from(viewpoints)
        .where(and(eq(viewpoints.id, id), eq(viewpoints.userId, userId)))
        .limit(1);
      if (!v) throw new NotFoundError('viewpoint not found');
      const [snap] = await db
        .select()
        .from(previewSnapshots)
        .where(eq(previewSnapshots.viewpointId, id))
        .orderBy(desc(previewSnapshots.generatedAt))
        .limit(1);
      return { ...v, snapshot: snap ?? null };
    },
    async create(
      userId: string,
      projectId: string,
      input: ViewpointInput,
      snapshot?: SnapshotInput,
    ): Promise<Viewpoint> {
      // Ownership of the project is verified in the same statement.
      const [owner] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
        .limit(1);
      if (!owner) throw new NotFoundError('project not found');
      const row: NewViewpoint = { ...input, id: ulid(), userId, projectId };
      const [v] = await db.insert(viewpoints).values(row).returning();
      if (snapshot) await this.saveSnapshot(v!.id, snapshot);
      await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      return v!;
    },
    async update(
      userId: string,
      id: string,
      patch: Partial<ViewpointInput>,
      snapshot?: SnapshotInput,
    ): Promise<Viewpoint> {
      const [v] = await db
        .update(viewpoints)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(viewpoints.id, id), eq(viewpoints.userId, userId)))
        .returning();
      if (!v) throw new NotFoundError('viewpoint not found');
      if (snapshot) await this.saveSnapshot(v.id, snapshot);
      return v;
    },
    async remove(userId: string, id: string): Promise<void> {
      const res = await db
        .delete(viewpoints)
        .where(and(eq(viewpoints.id, id), eq(viewpoints.userId, userId)))
        .returning({ id: viewpoints.id });
      if (res.length === 0) throw new NotFoundError('viewpoint not found');
    },
    async saveSnapshot(viewpointId: string, s: SnapshotInput): Promise<void> {
      await db.insert(previewSnapshots).values({
        id: ulid(),
        viewpointId,
        sourceType: s.sourceType,
        providerMetadata: s.providerMetadata ?? {},
        astronomyState: s.astronomyState ?? {},
        weatherState: s.weatherState ?? {},
        confidenceState: s.confidenceState ?? {},
        thumbnailDataUrl: s.thumbnailDataUrl ?? null,
      });
      // Keep only the newest snapshot per viewpoint; thumbnails are not history.
      const keep = db
        .select({ id: previewSnapshots.id })
        .from(previewSnapshots)
        .where(eq(previewSnapshots.viewpointId, viewpointId))
        .orderBy(desc(previewSnapshots.generatedAt))
        .limit(1);
      await db
        .delete(previewSnapshots)
        .where(
          and(
            eq(previewSnapshots.viewpointId, viewpointId),
            sql`${previewSnapshots.id} NOT IN (${keep})`,
          ),
        );
    },
  };
}

export function subscriptionsRepo(db: Db) {
  return {
    async forUser(userId: string): Promise<Subscription | null> {
      const [s] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .limit(1);
      return s ?? null;
    },
    async forCustomer(customerId: string): Promise<Subscription | null> {
      const [s] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.providerCustomerId, customerId))
        .limit(1);
      return s ?? null;
    },
    async upsert(record: Omit<Subscription, 'id' | 'updatedAt'>): Promise<Subscription> {
      const [s] = await db
        .insert(subscriptions)
        .values({ ...record, id: ulid(), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: {
            providerCustomerId: record.providerCustomerId,
            providerSubscriptionId: record.providerSubscriptionId,
            status: record.status,
            planKey: record.planKey,
            priceId: record.priceId,
            periodStart: record.periodStart,
            periodEnd: record.periodEnd,
            cancelAtPeriodEnd: record.cancelAtPeriodEnd,
            updatedAt: new Date(),
          },
        })
        .returning();
      return s!;
    },
    /** Idempotency guard: returns false when the event was already processed. */
    async recordEvent(e: {
      provider: string;
      providerEventId: string;
      type: string;
      userId: string | null;
      payload: unknown;
      outcome: string;
    }): Promise<boolean> {
      const res = await db
        .insert(subscriptionEvents)
        .values({ id: ulid(), ...e })
        .onConflictDoNothing({
          target: [subscriptionEvents.provider, subscriptionEvents.providerEventId],
        })
        .returning({ id: subscriptionEvents.id });
      return res.length > 0;
    },
    async wasProcessed(provider: string, providerEventId: string): Promise<boolean> {
      const [r] = await db
        .select({ id: subscriptionEvents.id })
        .from(subscriptionEvents)
        .where(
          and(
            eq(subscriptionEvents.provider, provider),
            eq(subscriptionEvents.providerEventId, providerEventId),
          ),
        )
        .limit(1);
      return r !== undefined;
    },
  };
}

export function usersRepo(db: Db) {
  return {
    async byId(id: string) {
      const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return u ?? null;
    },
    async byEmail(email: string) {
      const [u] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      return u ?? null;
    },
    async requestDeletion(id: string): Promise<void> {
      await db
        .update(users)
        .set({ deletionRequestedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, id));
    },
    /** Hard delete: cascades to projects, viewpoints, sessions, subscriptions. Audit row kept without PII. */
    async erase(id: string): Promise<void> {
      await db.delete(users).where(eq(users.id, id));
    },
  };
}

export function cacheRepo(db: Db) {
  return {
    async get<T>(namespace: string, key: string, now: Date = new Date()): Promise<T | null> {
      const [r] = await db
        .select()
        .from(providerCache)
        .where(and(eq(providerCache.namespace, namespace), eq(providerCache.cacheKey, key)))
        .limit(1);
      if (!r || r.expiresAt.getTime() <= now.getTime()) return null;
      return r.payload as T;
    },
    async set(
      namespace: string,
      key: string,
      payload: unknown,
      ttlSeconds: number,
      now: Date = new Date(),
    ): Promise<void> {
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
      await db
        .insert(providerCache)
        .values({ namespace, cacheKey: key, payload, expiresAt })
        .onConflictDoUpdate({
          target: [providerCache.namespace, providerCache.cacheKey],
          set: { payload, expiresAt, createdAt: now },
        });
    },
    async purgeExpired(now: Date = new Date()): Promise<number> {
      const res = await db
        .delete(providerCache)
        .where(lt(providerCache.expiresAt, now))
        .returning({ k: providerCache.cacheKey });
      return res.length;
    },
  };
}

export function usageRepo(db: Db) {
  return {
    /** Increment and return the new count for (userKey, day, resource). */
    async increment(
      userKey: string,
      resource: string,
      by = 1,
      day: string = new Date().toISOString().slice(0, 10),
    ): Promise<number> {
      const [r] = await db
        .insert(usageCounters)
        .values({ userKey, day, resource, count: by })
        .onConflictDoUpdate({
          target: [usageCounters.userKey, usageCounters.day, usageCounters.resource],
          set: { count: sql`${usageCounters.count} + ${by}`, updatedAt: new Date() },
        })
        .returning({ count: usageCounters.count });
      return r?.count ?? by;
    },
  };
}

export function auditRepo(db: Db) {
  return {
    async record(
      action: string,
      userId: string | null,
      metadata: Record<string, unknown> = {},
    ): Promise<void> {
      await db.insert(auditEvents).values({ id: ulid(), action, userId, metadata });
    },
  };
}

/** Retention job support (docs/PRIVACY.md): accounts whose deletion request is older than the window. */
export function retentionRepo(db: Db) {
  return {
    async usersDueForErasure(
      windowDays = 14,
      now: Date = new Date(),
    ): Promise<Array<{ id: string; requestedAt: Date }>> {
      const cutoff = new Date(now.getTime() - windowDays * 86_400_000);
      const rows = await db
        .select({ id: users.id, requestedAt: users.deletionRequestedAt })
        .from(users)
        .where(lt(users.deletionRequestedAt, cutoff));
      return rows.filter((r): r is { id: string; requestedAt: Date } => r.requestedAt !== null);
    },
  };
}

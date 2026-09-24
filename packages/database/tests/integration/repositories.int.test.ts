/**
 * Integration tests against a real PostgreSQL (CI: postgis/postgis:16). Skipped when DATABASE_URL is
 * unset so `pnpm test` stays green on a laptop without Postgres. Run: `pnpm --filter @lightmap/database test:integration`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../src/client.ts';
import { loadMigrations, migrate } from '../../src/migrate.ts';
import {
  NotFoundError,
  cacheRepo,
  projectsRepo,
  retentionRepo,
  subscriptionsRepo,
  usageRepo,
  usersRepo,
  viewpointsRepo,
} from '../../src/repositories.ts';
import { schema, ulid } from '../../src/index.ts';

const url = process.env['DATABASE_URL'];
const run = url ? describe : describe.skip;

run('repositories (integration)', () => {
  let h: DbHandle;
  let alice: string;
  let bob: string;
  beforeAll(async () => {
    h = createDb(url!, { max: 2 });
    await migrate(h.executor, await loadMigrations());
    alice = ulid();
    bob = ulid();
    await h.db.insert(schema.users).values([
      { id: alice, email: `alice-${alice}@test.local` },
      { id: bob, email: `bob-${bob}@test.local` },
    ]);
  });
  afterAll(async () => {
    await usersRepo(h.db).erase(alice);
    await usersRepo(h.db).erase(bob);
    await h.close();
  });

  it("projects and viewpoints are owner-scoped: bob cannot read, update or delete alice's", async () => {
    const projects = projectsRepo(h.db);
    const p = await projects.create(alice, { name: 'Kailua sunrise', shootDate: '2026-05-31' });
    expect((await projects.list(alice)).map((x) => x.id)).toContain(p.id);
    expect(await projects.list(bob)).toEqual([]);
    await expect(projects.get(bob, p.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(projects.update(bob, p.id, { name: 'stolen' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(projects.remove(bob, p.id)).rejects.toBeInstanceOf(NotFoundError);

    const vps = viewpointsRepo(h.db);
    const input = {
      label: 'Beach',
      latitude: 21.397,
      longitude: -157.727,
      elevationM: 2,
      timezone: 'Pacific/Honolulu',
      headingDeg: 90,
      pitchDeg: 0,
      fieldOfViewDeg: 73.7,
      focalLengthEquivalentMm: 24,
      selectedDatetimeUtc: new Date('2026-05-31T22:30:00Z'),
      weatherMode: 'SCENARIO' as const,
      weatherScenario: 'clear',
      previewSourceType: 'SIMULATED_LIGHTING' as const,
    };
    await expect(vps.create(bob, p.id, input)).rejects.toBeInstanceOf(NotFoundError);
    const v = await vps.create(alice, p.id, input, {
      sourceType: 'SIMULATED_LIGHTING',
      providerMetadata: {},
      astronomyState: { el: 89.3 },
      weatherState: {},
      confidenceState: {},
      thumbnailDataUrl: 'data:image/jpeg;base64,AAAA',
    });
    expect(await vps.countInProject(alice, p.id)).toBe(1);
    const got = await vps.get(alice, v.id);
    expect(got.snapshot?.thumbnailDataUrl).toBe('data:image/jpeg;base64,AAAA');
    await vps.saveSnapshot(v.id, {
      sourceType: 'SIMULATED_LIGHTING',
      providerMetadata: {},
      astronomyState: {},
      weatherState: {},
      confidenceState: {},
      thumbnailDataUrl: 'data:image/jpeg;base64,BBBB',
    });
    const counted = await h.sql<
      Array<{ n: string }>
    >`select count(*)::text as n from preview_snapshots where viewpoint_id = ${v.id}`;
    expect(Number(counted[0]?.n)).toBe(1); // only the newest snapshot is kept
    await expect(vps.get(bob, v.id)).rejects.toBeInstanceOf(NotFoundError);
    const full = await projects.get(alice, p.id);
    expect(full.viewpoints).toHaveLength(1);
    await projects.remove(alice, p.id);
    await expect(vps.get(alice, v.id)).rejects.toBeInstanceOf(NotFoundError); // cascade
  });

  it('subscription events are idempotent and upserts replace by user', async () => {
    const subs = subscriptionsRepo(h.db);
    expect(
      await subs.recordEvent({
        provider: 'stripe',
        providerEventId: `evt_${alice}`,
        type: 't',
        userId: alice,
        payload: {},
        outcome: 'processed',
      }),
    ).toBe(true);
    expect(
      await subs.recordEvent({
        provider: 'stripe',
        providerEventId: `evt_${alice}`,
        type: 't',
        userId: alice,
        payload: {},
        outcome: 'processed',
      }),
    ).toBe(false);
    expect(await subs.wasProcessed('stripe', `evt_${alice}`)).toBe(true);
    await subs.upsert({
      provider: 'stripe',
      userId: alice,
      providerCustomerId: `cus_${alice}`,
      providerSubscriptionId: 'sub_1',
      status: 'active',
      planKey: 'pro',
      priceId: 'p',
      periodStart: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
    });
    await subs.upsert({
      provider: 'stripe',
      userId: alice,
      providerCustomerId: `cus_${alice}`,
      providerSubscriptionId: 'sub_1',
      status: 'canceled',
      planKey: 'pro',
      priceId: 'p',
      periodStart: null,
      periodEnd: null,
      cancelAtPeriodEnd: true,
    });
    expect((await subs.forUser(alice))?.status).toBe('canceled');
    expect((await subs.forCustomer(`cus_${alice}`))?.userId).toBe(alice);
  });

  it('cache respects TTL and usage counters accumulate', async () => {
    const cache = cacheRepo(h.db);
    const now = new Date();
    await cache.set('test', `k-${alice}`, { a: 1 }, 60, now);
    expect(await cache.get('test', `k-${alice}`, now)).toEqual({ a: 1 });
    expect(await cache.get('test', `k-${alice}`, new Date(now.getTime() + 61_000))).toBeNull();
    const usage = usageRepo(h.db);
    const day = `it-${alice.slice(0, 6)}`;
    expect(await usage.increment(alice, 'weather', 1, day)).toBe(1);
    expect(await usage.increment(alice, 'weather', 2, day)).toBe(3);
  });

  it('deletion requests become due after the window', async () => {
    await usersRepo(h.db).requestDeletion(bob);
    const soon = await retentionRepo(h.db).usersDueForErasure(14, new Date());
    expect(soon.map((u) => u.id)).not.toContain(bob);
    const later = await retentionRepo(h.db).usersDueForErasure(
      14,
      new Date(Date.now() + 15 * 86_400_000),
    );
    expect(later.map((u) => u.id)).toContain(bob);
  });
});

import { describe, expect, it } from 'vitest';
import { PAST_DUE_GRACE_DAYS, PLANS, can, deriveEntitlements, planForPrice } from '../src/index.ts';

const now = new Date('2026-06-01T00:00:00Z');
const future = '2026-07-01T00:00:00Z';
const past = '2026-05-01T00:00:00Z';

describe('deriveEntitlements', () => {
  it('no subscription → free plan', () => {
    const s = deriveEntitlements(null, now);
    expect(s.effectivePlan).toBe('free');
    expect(s.entitlements).not.toContain('future_date_planning');
    expect(s.limits.futureDateWindowDays).toBe(14);
  });
  it('active pro → pro; cancel-at-period-end keeps access until then', () => {
    const s = deriveEntitlements(
      { planKey: 'pro', status: 'active', periodEnd: future, cancelAtPeriodEnd: true },
      now,
    );
    expect(s.effectivePlan).toBe('pro');
    expect(s.accessEndsAt).toBe(future);
    const ended = deriveEntitlements(
      { planKey: 'pro', status: 'canceled', periodEnd: past, cancelAtPeriodEnd: true },
      now,
    );
    expect(ended.effectivePlan).toBe('free');
    // `canceled` means Stripe has ended access, even if the old period end is in the future
    // (immediate cancellation by the operator or fraud review).
    const immediate = deriveEntitlements(
      { planKey: 'pro', status: 'canceled', periodEnd: future, cancelAtPeriodEnd: true },
      now,
    );
    expect(immediate.effectivePlan).toBe('free');
  });
  it('past_due keeps access for the grace window, then drops to free', () => {
    const inGrace = deriveEntitlements(
      {
        planKey: 'pro',
        status: 'past_due',
        periodEnd: '2026-05-28T00:00:00Z',
        cancelAtPeriodEnd: false,
      },
      now,
    );
    expect(inGrace.effectivePlan).toBe('pro');
    expect(inGrace.grace).toBe(true);
    const graceOver = deriveEntitlements(
      {
        planKey: 'pro',
        status: 'past_due',
        periodEnd: new Date(now.getTime() - (PAST_DUE_GRACE_DAYS + 1) * 86_400_000).toISOString(),
        cancelAtPeriodEnd: false,
      },
      now,
    );
    expect(graceOver.effectivePlan).toBe('free');
  });
  it('unpaid / incomplete / paused → free, but the plan key is remembered', () => {
    for (const status of ['unpaid', 'incomplete', 'incomplete_expired', 'paused'] as const) {
      const s = deriveEntitlements(
        { planKey: 'pro', status, periodEnd: future, cancelAtPeriodEnd: false },
        now,
      );
      expect(s.effectivePlan).toBe('free');
      expect(s.plan).toBe('pro');
    }
  });
  it('trialing counts as active', () => {
    expect(
      deriveEntitlements(
        { planKey: 'pro', status: 'trialing', periodEnd: future, cancelAtPeriodEnd: false },
        now,
      ).entitlements,
    ).toContain('export_preview');
  });
});

describe('can()', () => {
  const free = deriveEntitlements(null, now);
  const pro = deriveEntitlements(
    { planKey: 'pro', status: 'active', periodEnd: future, cancelAtPeriodEnd: false },
    now,
  );
  it('free users plan inside the 14-day window, and are told why beyond it', () => {
    expect(
      can(free, 'future_date_planning', { today: '2026-05-01', targetDate: '2026-05-10' }).allowed,
    ).toBe(true);
    const d = can(free, 'future_date_planning', { today: '2026-05-01', targetDate: '2026-05-31' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('14 days');
    expect(d.upgradeTo).toBe('pro');
    expect(
      can(free, 'future_date_planning', { today: '2026-05-01', targetDate: '2026-04-01' }).allowed,
    ).toBe(false);
    expect(
      can(pro, 'future_date_planning', { today: '2026-05-01', targetDate: '2031-05-31' }).allowed,
    ).toBe(true);
  });
  it('enforces save limits with counts', () => {
    expect(can(free, 'saved_projects', { projectCount: 0 }).allowed).toBe(true);
    expect(can(free, 'saved_projects', { projectCount: 1 }).allowed).toBe(false);
    expect(
      can(free, 'saved_viewpoints', { viewpointCountInProject: 3, viewpointCountTotal: 3 }).allowed,
    ).toBe(false);
    expect(can(pro, 'saved_projects', { projectCount: 999 }).allowed).toBe(true);
    expect(can(pro, 'saved_viewpoints', { viewpointCountInProject: 200 }).allowed).toBe(false);
  });
  it('quality requests respect the plan ceiling', () => {
    expect(can(free, 'high_quality_preview', { requestedQuality: 1 }).allowed).toBe(true);
    expect(can(free, 'high_quality_preview', { requestedQuality: 3 }).allowed).toBe(false);
    expect(can(pro, 'high_quality_preview', { requestedQuality: 3 }).allowed).toBe(true);
  });
  it('pro-only features name themselves in the denial', () => {
    expect(can(free, 'export_preview').reason).toContain('Planning-card export');
    expect(can(free, 'moon_planning').allowed).toBe(true); // free includes basic moon
    expect(can(free, 'advanced_camera_tools').allowed).toBe(false);
    expect(can(free, 'map_access').allowed).toBe(true);
    const finder = can(free, 'reverse_planning');
    expect(finder.allowed).toBe(false);
    expect(finder.reason).toContain('14-day window');
    expect(can(pro, 'reverse_planning').allowed).toBe(true);
    expect(can(free, 'climatology').reason).toContain('Typical conditions');
    expect(can(pro, 'climatology').allowed).toBe(true);
  });
  it('maps Stripe prices to plans without guessing', () => {
    const map = { pro: ['price_month', 'price_year'] };
    expect(planForPrice('price_year', map)).toBe('pro');
    expect(planForPrice('price_other', map)).toBeNull();
    expect(planForPrice(undefined, map)).toBeNull();
    expect(Object.keys(PLANS)).toEqual(['free', 'pro', 'studio']);
  });
});

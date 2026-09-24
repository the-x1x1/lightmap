/**
 * Entitlements (plan §15): one central place that turns a subscription record into what the user
 * may do. No `if (plan === 'pro')` anywhere else — the UI and API ask `can(snapshot, key, ctx)`.
 * Pure and unit tested. The server derives the snapshot; the client only ever receives it.
 */

export const ENTITLEMENT_KEYS = [
  'map_access',
  'future_date_planning',
  'saved_projects',
  'saved_viewpoints',
  'forecast_detail',
  'high_quality_preview',
  'export_preview',
  'moon_planning',
  'advanced_camera_tools',
  'reverse_planning',
  'climatology',
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export type PlanKey = 'free' | 'pro' | 'studio';

export interface Limits {
  /** Days ahead of today a free user may plan; null = unlimited. */
  futureDateWindowDays: number | null;
  /** Days into the past; null = unlimited. */
  pastDateWindowDays: number | null;
  maxProjects: number | null;
  maxViewpointsPerProject: number | null;
  maxViewpointsTotal: number | null;
  /** Highest render quality rung the plan may request (0–3, plan §6). */
  maxPreviewQuality: 0 | 1 | 2 | 3;
}

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  entitlements: ReadonlySet<EntitlementKey>;
  limits: Limits;
  /** Shown on the paywall. */
  highlights: string[];
}

const set = (...k: EntitlementKey[]) => new Set<EntitlementKey>(k) as ReadonlySet<EntitlementKey>;

export const PLANS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: 'free',
    name: 'Free',
    entitlements: set('map_access', 'saved_projects', 'saved_viewpoints', 'moon_planning'),
    limits: {
      futureDateWindowDays: 14,
      pastDateWindowDays: 7,
      maxProjects: 1,
      maxViewpointsPerProject: 3,
      maxViewpointsTotal: 3,
      maxPreviewQuality: 1,
    },
    highlights: [
      'Explore the map anywhere',
      'Plan up to 14 days ahead',
      'Sun, twilight and basic moon data',
      'One project with three saved viewpoints',
      'Standard preview',
    ],
  },
  pro: {
    key: 'pro',
    name: 'Photographer Pro',
    entitlements: set(
      'map_access',
      'future_date_planning',
      'saved_projects',
      'saved_viewpoints',
      'forecast_detail',
      'high_quality_preview',
      'export_preview',
      'moon_planning',
      'advanced_camera_tools',
      'reverse_planning',
      'climatology',
    ),
    limits: {
      futureDateWindowDays: null,
      pastDateWindowDays: null,
      maxProjects: null,
      maxViewpointsPerProject: 200,
      maxViewpointsTotal: 5000,
      maxPreviewQuality: 3,
    },
    highlights: [
      'Plan any date, years ahead',
      'Unlimited projects and saved viewpoints',
      'Hourly forecast detail and scenario comparison',
      'Moon planning',
      'High-quality preview and planning-card export',
      'Camera tools: lens presets, heading and pitch',
      'Light finder: every date the sun or moon lands where you want it',
      'Typical conditions for any month, from ten years of climate data',
    ],
  },
  studio: {
    key: 'studio',
    name: 'Studio',
    entitlements: set(
      'map_access',
      'future_date_planning',
      'saved_projects',
      'saved_viewpoints',
      'forecast_detail',
      'high_quality_preview',
      'export_preview',
      'moon_planning',
      'advanced_camera_tools',
      'reverse_planning',
      'climatology',
    ),
    limits: {
      futureDateWindowDays: null,
      pastDateWindowDays: null,
      maxProjects: null,
      maxViewpointsPerProject: 500,
      maxViewpointsTotal: 50_000,
      maxPreviewQuality: 3,
    },
    highlights: ['Everything in Pro', 'Team sharing (coming later)'],
  },
};

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export interface SubscriptionRecord {
  planKey: PlanKey;
  status: SubscriptionStatus;
  /** ISO instant the current period ends. */
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface EntitlementSnapshot {
  plan: PlanKey;
  planName: string;
  /** Effective plan after status rules (a canceled Pro is effectively Free after period end). */
  effectivePlan: PlanKey;
  status: SubscriptionStatus | 'none';
  entitlements: EntitlementKey[];
  limits: Limits;
  /** Whether the subscription is in a grace state (past_due) — UI shows a fix-payment nudge but keeps access. */
  grace: boolean;
  /** ISO instant access ends if cancelled, for the UI. */
  accessEndsAt: string | null;
  computedAt: string;
}

/** Past-due grace: keep access for this long after the period ends while Stripe retries payment. */
export const PAST_DUE_GRACE_DAYS = 7;

/**
 * Derive the effective snapshot. Status rules:
 *  - active / trialing → the plan applies.
 *  - past_due → the plan applies for PAST_DUE_GRACE_DAYS after periodEnd, flagged as grace.
 *  - active + cancelAtPeriodEnd → plan applies until periodEnd (Stripe keeps it `active` until then).
 *  - canceled → free immediately (Stripe emits it when access has ended).
 *  - anything else → free.
 * Never trusts a client-supplied tier: callers pass the server's subscription record.
 */
export function deriveEntitlements(
  sub: SubscriptionRecord | null,
  now: Date = new Date(),
): EntitlementSnapshot {
  const computedAt = now.toISOString();
  const free = PLANS.free;
  if (!sub) return snapshot(free, free, 'none', false, null, computedAt);
  const plan = PLANS[sub.planKey] ?? free;
  const periodEnd = sub.periodEnd ? new Date(sub.periodEnd) : null;
  const periodActive = periodEnd === null || periodEnd.getTime() > now.getTime();

  switch (sub.status) {
    case 'active':
    case 'trialing':
      if (periodActive || !sub.cancelAtPeriodEnd)
        return snapshot(
          plan,
          plan,
          sub.status,
          false,
          sub.cancelAtPeriodEnd ? sub.periodEnd : null,
          computedAt,
        );
      return snapshot(plan, free, sub.status, false, sub.periodEnd, computedAt);
    case 'past_due': {
      const graceEnd = periodEnd
        ? new Date(periodEnd.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000)
        : null;
      const inGrace = graceEnd === null || graceEnd.getTime() > now.getTime();
      return snapshot(
        plan,
        inGrace ? plan : free,
        sub.status,
        inGrace,
        graceEnd?.toISOString() ?? null,
        computedAt,
      );
    }
    case 'canceled':
      // Stripe sets `canceled` when access has actually ended — immediately for an operator or
      // fraud cancellation, or at period end for cancel_at_period_end (which stays `active` until
      // then). Either way, access is over now (plan §34: never accidentally grant).
      return snapshot(plan, free, sub.status, false, sub.periodEnd, computedAt);
    case 'paused':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
      return snapshot(plan, free, sub.status, false, null, computedAt);
  }
}

function snapshot(
  plan: PlanDefinition,
  effective: PlanDefinition,
  status: SubscriptionStatus | 'none',
  grace: boolean,
  accessEndsAt: string | null,
  computedAt: string,
): EntitlementSnapshot {
  return {
    plan: plan.key,
    planName: plan.name,
    effectivePlan: effective.key,
    status,
    entitlements: [...effective.entitlements],
    limits: { ...effective.limits },
    grace,
    accessEndsAt,
    computedAt,
  };
}

export interface EntitlementContext {
  /** For future_date_planning: the civil date being planned and "today" at the location. */
  targetDate?: string;
  today?: string;
  /** For saved_projects / saved_viewpoints: current counts. */
  projectCount?: number;
  viewpointCountInProject?: number;
  viewpointCountTotal?: number;
  /** For high_quality_preview: the requested quality rung. */
  requestedQuality?: 0 | 1 | 2 | 3;
}

export interface EntitlementDecision {
  allowed: boolean;
  key: EntitlementKey;
  /** Human-readable reason when denied; the paywall shows it. */
  reason?: string;
  /** Which plan would unlock it. */
  upgradeTo?: PlanKey;
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}

/** The single authorization question the app asks. */
export function can(
  snap: EntitlementSnapshot,
  key: EntitlementKey,
  ctx: EntitlementContext = {},
): EntitlementDecision {
  const has = snap.entitlements.includes(key);
  const upgradeTo: PlanKey = 'pro';
  switch (key) {
    case 'map_access':
      return { allowed: has, key };
    case 'future_date_planning': {
      if (has) return { allowed: true, key };
      // Free users may still plan inside the window; this checks the window.
      if (ctx.targetDate && ctx.today) {
        const ahead = daysBetween(ctx.today, ctx.targetDate);
        const maxAhead = snap.limits.futureDateWindowDays;
        const maxBack = snap.limits.pastDateWindowDays;
        if (maxAhead !== null && ahead > maxAhead)
          return {
            allowed: false,
            key,
            reason: `Free plans can plan up to ${maxAhead} days ahead. This date is ${ahead} days away.`,
            upgradeTo,
          };
        if (maxBack !== null && -ahead > maxBack)
          return {
            allowed: false,
            key,
            reason: `Free plans can look back ${maxBack} days.`,
            upgradeTo,
          };
        return { allowed: true, key };
      }
      return {
        allowed: false,
        key,
        reason: 'Unrestricted date planning is part of Pro.',
        upgradeTo,
      };
    }
    case 'saved_projects': {
      if (!has)
        return { allowed: false, key, reason: 'Saving projects requires an account.', upgradeTo };
      const max = snap.limits.maxProjects;
      if (max !== null && (ctx.projectCount ?? 0) >= max)
        return { allowed: false, key, reason: `Free plans include ${max} project.`, upgradeTo };
      return { allowed: true, key };
    }
    case 'saved_viewpoints': {
      if (!has)
        return { allowed: false, key, reason: 'Saving viewpoints requires an account.', upgradeTo };
      const perProject = snap.limits.maxViewpointsPerProject;
      const total = snap.limits.maxViewpointsTotal;
      if (perProject !== null && (ctx.viewpointCountInProject ?? 0) >= perProject)
        return {
          allowed: false,
          key,
          reason: `This plan allows ${perProject} saved viewpoints per project.`,
          upgradeTo,
        };
      if (total !== null && (ctx.viewpointCountTotal ?? 0) >= total)
        return {
          allowed: false,
          key,
          reason: `This plan allows ${total} saved viewpoints in total.`,
          upgradeTo,
        };
      return { allowed: true, key };
    }
    case 'high_quality_preview': {
      const q = ctx.requestedQuality ?? 2;
      if (q <= snap.limits.maxPreviewQuality) return { allowed: true, key };
      return {
        allowed: has,
        key,
        ...(has ? {} : { reason: 'High-quality previews are part of Pro.', upgradeTo }),
      };
    }
    case 'reverse_planning': {
      // Free plans may search inside their date window (same rule as future_date_planning), so
      // the tool is usable — and the reason to upgrade is concrete when the range is clipped.
      if (has) return { allowed: true, key };
      return {
        allowed: false,
        key,
        reason: `${label(key)} beyond your ${snap.limits.futureDateWindowDays ?? 14}-day window is part of Pro.`,
        upgradeTo,
      };
    }
    case 'forecast_detail':
    case 'export_preview':
    case 'moon_planning':
    case 'advanced_camera_tools':
    case 'climatology':
      return has
        ? { allowed: true, key }
        : { allowed: false, key, reason: `${label(key)} is part of Pro.`, upgradeTo };
  }
}

export function label(key: EntitlementKey): string {
  const labels: Record<EntitlementKey, string> = {
    map_access: 'Map access',
    future_date_planning: 'Unrestricted date planning',
    saved_projects: 'Projects',
    saved_viewpoints: 'Saved viewpoints',
    forecast_detail: 'Hourly forecast detail',
    high_quality_preview: 'High-quality preview',
    export_preview: 'Planning-card export',
    moon_planning: 'Moon planning',
    advanced_camera_tools: 'Advanced camera tools',
    reverse_planning: 'Light finder (reverse planning)',
    climatology: 'Typical conditions (climatology)',
  };
  return labels[key];
}

/** Plan key from a Stripe price id via the env-configured map. Unknown → null (never guess Pro). */
export function planForPrice(
  priceId: string | null | undefined,
  priceMap: Partial<Record<PlanKey, string[]>>,
): PlanKey | null {
  if (!priceId) return null;
  for (const [plan, ids] of Object.entries(priceMap) as Array<[PlanKey, string[] | undefined]>) {
    if (ids?.includes(priceId)) return plan;
  }
  return null;
}

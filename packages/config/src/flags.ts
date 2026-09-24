/**
 * Feature flags for unfinished or paid features (plan §35: "Use feature flags for unfinished
 * paid features. Never leave half-built navigation items visible."). Flags are static per build;
 * an env override exists for staging. Anything `false` here renders nothing — no disabled tabs.
 */
export const featureFlags = {
  /** Phase 5. Requires a licensed imagery contract. */
  realReferenceImagery: false,
  /** Phase 6/§26. Reverse planning solver. */
  reversePlanning: false,
  /** Phase 7. Climatology "typical for this month". */
  climatology: false,
  /** Phase 4. PNG export of a planning card. */
  exportPreview: false,
  /** Moon planning panel (Pro). Shipping in v0.1 as read-only lunar state. */
  moonPlanning: true,
  /** Development-only performance panel (plan §27). */
  perfPanel: true,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isEnabled(flag: FeatureFlag, overrides?: Partial<Record<FeatureFlag, boolean>>): boolean {
  return overrides?.[flag] ?? featureFlags[flag];
}

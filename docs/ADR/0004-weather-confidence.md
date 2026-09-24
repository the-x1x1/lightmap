# ADR-0004: Independent confidence dimensions and horizon-based weather mode

**Status:** Accepted · **Date:** 2026-09 · **Plan:** §1, §3, §9, §11

## Context

The product's value rests on trust. A photographer planning a shoot six months out must not be told
the weather; a photographer planning tomorrow should see a real forecast and know how firm it is.
Terrain may be exact while scene detail is coarse; astronomy is exact even when nothing else is. A
single "accuracy %" would hide all of this and would be impossible to define honestly.

## Decision

1. **Confidence is a set of independent dimensions, never a percentage.** `ConfidenceState` in
   `packages/scene` holds `astronomy`, `terrain`, `sceneDetail`, `environment` (derived from the
   previous two), `weather` and `imagery`, each with its own scale and a one-line, user-facing
   reason:
   - astronomy: HIGH unless inputs are invalid;
   - terrain: HIGH with a real terrain provider, LOW on the ellipsoid;
   - scene detail: HIGH (street basemap + buildings) / MEDIUM (street or regional) / LOW (coarse);
   - weather: HIGH / MEDIUM / LOW from the horizon, or **SCENARIO**;
   - imagery: REAL_REFERENCE or NONE.
   `deriveConfidence()` and `deriveSourceMode()` are pure functions with exhaustive unit tests.
2. **The overall label is one of three source modes** derived from confidence, not chosen by hand:
   REAL_REFERENCE when licensed imagery is shown; SIMULATED_LIGHTING when terrain is HIGH and scene
   detail is not LOW; otherwise ESTIMATED_PREVIEW. Each has a fixed description of what it can and
   cannot claim.
3. **Weather mode is decided by lead time against the provider's declared horizon**
   (`decideWeatherMode` in `packages/weather/src/horizon.ts`): FORECAST (≤ reliable horizon; HIGH
   ≤ 48 h, MEDIUM after), EXTENDED_FORECAST (to the provider's maximum; LOW), SCENARIO beyond it,
   RECENT_PAST within the archive, PAST beyond it (treated as scenario). Provider failure also yields
   SCENARIO confidence. The provider declares the horizon in its capabilities; the UI never hard-codes
   "7 days".
4. **A scenario is never called a forecast.** Scenario wording ("Forecast unavailable this far
   ahead — compare scenarios", "Scenario: Overcast") is fixed in the horizon decision and confidence
   notes; the badge component renders the mode, not a free string. An E2E test asserts that a
   long-range date never shows a bare "Forecast" claim. When a user pins a scenario inside the
   forecast window, the badge says "Comparing scenario … (forecast: …)" so the forecast stays
   visible.
5. **Climatology (Phase 7) will be a separate indicator** with SCENARIO-level confidence, never a
   forecast badge.

## Consequences

- The confidence panel can say "Astronomy: High · Terrain: High · Scene detail: Medium · Weather:
  Scenario · Real reference: Unavailable" — precise and honest.
- Adding a data source improves exactly one dimension; nothing else changes.
- Users must read five short lines rather than one number. The main screen shows only the source
  label and a compact summary; the full breakdown is one tap away.
- Weather confidence depends on the client's clock ("now"); the server re-derives the horizon
  decision and refuses fetches outside it, so a wrong client clock cannot buy a forecast.
- Long-range dates render with whatever scenario the user picked; the default is Clear, which is a
  choice, not a prediction — the UI labels it as such.

## Alternatives considered

- **Single 0–100 accuracy score.** Rejected as unexplainable and dishonest (plan §11: "far more
  trustworthy than a fake 92 %").
- **Show climatological averages as the default beyond the horizon.** Rejected for v0.1: without a
  clearly separate label it reads as a forecast; deferred to Phase 7 with strict labelling.
- **Always fetch the provider's full 16 days as "forecast".** Rejected: days 8–16 are meaningfully
  less reliable and are labelled EXTENDED_FORECAST / LOW instead.
- **Use historical weather for past dates silently.** Rejected; RECENT_PAST is labelled as archive
  data and older dates are explicitly "not loaded".

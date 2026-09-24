# Changelog

All notable changes. Versions follow semver; `pnpm release <version>` prepends entries from commits.

## Unreleased

- `pnpm usage:report`: daily per-resource totals from `usage_counters` (aggregates only).
- **Sensor formats** (Pro camera tools): pick your sensor and type your lens's focal length.
- Light finder searches run in a Web Worker (main-thread fallback).
- **Shot variants**: save the same viewpoint at other times/scenarios under one card
  (migration `0003_viewpoint_variants`, `parentViewpointId`, cascade, one level, counted toward
  limits); integration test.
- **Light finder: point in the view** — click where the sun/moon should be in the viewpoint
  preview; the finder searches for that direction (`directionFromFrame`, tested); a ring marks it.
- **Light finder (reverse planning, plan §26)**: `findDirectionMatches()` finds every instant in a
  date range when the sun or moon sits at a target azimuth (and optionally elevation) from a
  viewpoint; panel in the planner with frame-centre / current / manual targets, moon illumination
  floor, tolerances, and jump-to-instant results. New `reverse_planning` entitlement (Free: inside
  the date window; Pro: any range).
- **Planning-card export** (Phase 4 "preview export"): a PNG of the current frame with the solar
  facts, weather mode, source label, confidence and attribution, rendered in the browser; Pro via
  `export_preview`, paywall reason for Free.
- **Hour by hour (Pro `forecast_detail`)**: per-hour direct-light bars and bright windows for
  the fetched day, table alternative, nothing shown on scenario days (`hourlyOutlook`, tested).
- **PWA baseline**: installable manifest (id/scope/categories, 192/512 + maskable PNG icons,
  `display_override`), apple-touch-icon, `?source=pwa` start URL.
- **Renderer (Phase 4)**: blue hour is blue — twilight dome clamp at −0.6° with a civil-twilight
  restoration term that keeps the sunset glow warm; low-Sun zenith lift; aerial perspective toward
  the horizon by depth and Sun elevation (`horizonHaze` uniform); textured overcast decks. Verified
  in the headless smoke harness (new contact sheet in `docs/media`).
- **Climatology (Phase 7)**: "Typical for this month" — ten-year ERA5 shares of the five scenario
  classes in daylight hours (Open-Meteo archive adapter + fixture, pure summariser with tests, API
  route with 30-day cache and per-plan budget, `climatology` entitlement), tap-to-compare, never a
  forecast.
- **Accessibility pass (plan §28)**: skip link and DOM order, roving-tabindex radio groups
  (`RadioGroup`/`useRovingRadio` in `@lightmap/ui`), combobox `aria-activedescendant`, permanent
  status regions, focus management on panel swaps/deletes/preview collapse, `inert` collapsed sheet,
  confidence notes as visible text, reduced-motion camera jumps, contrast fixes, timeline event
  keys. Sign-in failures are now reported instead of shown as success.
- Daily retention workflow (`retention.yml`).
- Build verified against the installed dependency set: typecheck, type-aware lint (zero findings),
  licence gate (482 packages, two recorded exceptions), notices regenerated; db scripts read `.env`;
  Docker Compose for local PostGIS; release workflow tolerates a missing production host.
- Initial build of LightMap v0.1: monorepo, WorldView reuse audit, astronomy (USNO-validated),
  weather (Open-Meteo + scenarios + horizon), SceneState + confidence, Cesium renderer with
  grade shader and quality governor, web app (map shell, timeline, scenarios, preview, camera,
  projects, account), API, database + migrations, Stripe webhooks, entitlements, Auth.js,
  observability, CI/security/release workflows, documentation set and ADRs.

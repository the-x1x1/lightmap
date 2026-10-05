# Changelog

All notable changes. Versions follow semver; `pnpm release <version>` prepends entries from commits.

## Unreleased

- **Depth of field (Phase 6)**: "Your camera" gains an aperture and focus-distance pair that
  reports the near and far limits of sharpness for the real lens on the chosen sensor, whether
  the sun, moon and horizon fall inside the zone, and a "Focus at hyperfocal" button.
  `depthOfField()`, `hyperfocalDistanceM()`, `circleOfConfusionMm()` (diagonal ÷ 1500) in
  `@lightmap/scene`, checked against the textbook 50 mm f/8 case; sensor presets now carry their
  height. The preview is never blurred.
- **Horizon levelling (Phase 6)**: "Level & thirds guide" in the viewpoint view — a
  rule-of-thirds grid, the true-level line and the modelled terrain skyline (dotted, "terrain
  only"), with buttons that pitch the camera so level sits on the low third, the centre or the
  high third. `levelLineY()`, `pitchForHorizonAt()`, `skylinePath()` in `@lightmap/scene`.
- **Security**: nodemailer 10.0.9+ across the workspace (GHSA-v53p-9fqp-m79j and
  GHSA-prgh-xp8r-p3m5, high: address-parser denial of service; plus three moderate advisories).
  Only `createTransport`/`sendMail` are used, unchanged across the major.
- **Point with phone (Phase 9 field mode)**: in viewpoint mode on a phone, the camera follows
  the device's back camera — compass heading and tilt from DeviceOrientation, screen-rotation
  independent, smoothed and throttled; iOS permission prompt handled; manual input takes over;
  devices without a compass are told so. `cameraPointingFromOrientation()` and `blendHeading()`
  in `@lightmap/scene` (tested against hand-computed poses); `normalizeHeading()` can no longer
  return 360 for a tiny negative input.
- **Legal drafts**: `/legal/privacy` and `/legal/terms` are now full drafts derived from
  `docs/PRIVACY.md` and the product spec (what stays on the device, what we store, recipients,
  retention, deletion, offline cache; accuracy statements, plans and cancellation, past-due grace,
  acceptable use, attribution), still flagged for counsel review with bracketed items to fill.
- **Device conditions (Phase 4)**: the quality governor's ceiling now follows the battery and
  Save-Data while the app runs — draining below 50 % caps at Balanced, below 20 % at Battery;
  Save-Data / `prefers-reduced-data` caps at Balanced; charging lifts the cap. Conditions never
  switch shadows off. `conditionsCeiling()`, `effectiveCeiling()`, `watchDeviceConditions()`.
- **Offline project cache (Phase 9)**: in production a service worker (`public/sw.js`) keeps the
  planner page, its chunks and the signed-in user's own projects, viewpoints, session and
  entitlements, so saved plans open in the field with no signal — astronomy, the light finder,
  DOF and the level guide work offline; weather falls back to scenarios. Third-party
  map/terrain/weather data is never cached; live responses are handed over before they are
  stored; user data is dropped on sign-out, account deletion, a signed-out session or a change of
  user, and project/viewpoint writes drop the cached project list. The network banner shows the
  age of cached data and clears on the next live response. Unit-tested in a VM sandbox
  (`sw.test.ts`).

## v0.1.0 — 2026-09-25

- **Terrain horizon** ("when does the sun clear the ridge?"): the land horizon around the pin is
  sampled through the renderer from the DEM (curvature + refraction; `horizon.ts`, tested on a
  synthetic ridge); the scene knows whether the sun/moon is behind terrain and the day's first and
  last light over it. "Sun behind terrain" badge, `▲/▽ Ridge` timeline markers when they differ
  from sunrise/sunset, rows in Sun & moon details, finder results tagged/hideable, caveat
  everywhere (trees/buildings not modelled). `SceneHost.sampleGroundHeights`, store
  `horizonProfile`, `useTerrainHorizon`.
- **Shadow quality (Phase 4)**: low-Sun shadows are no longer faded away by the renderer
  (Cesium's `fadingEnabled` off — whether shadows exist is decided by the Sun and the cloud, not
  by taste); shadow reach follows the camera (20 km at eye level, 3× the orbit range in map view).
  The smoke harness now renders a tower and **measures** its shadow's direction, length and
  darkness from the frame.
- **Climatology by hour of day**: "Typical for this month" now includes 24 hour-of-day bars
  (mean cloud, clear share, wet share; night dimmed; selected hour ringed; table for assistive
  tech) and a pattern line naming the clearest and cloudiest three-hour stretch when the month
  has one (`byHour`, `daylightPattern()`, tested). Cache key bumped to `v2`.
- **Mobile pass**: fields are 16 px on touch devices (no iOS focus zoom); the sheet and top bar
  clear the safe-area insets; the sheet handle takes a swipe; a collapsed sheet shows a glance
  line (time · phase · sun bearing · weather basis) that opens it; taps in the viewpoint view
  tolerate 10 px of finger wobble; larger touch targets for tabs, markers and the chip.
- **Layered clouds (Phase 4)**: the sky is three decks — low, mid, high — with cover from the
  forecast's own `cloud_cover_low/mid/high` (`AtmosphereParameters.cloudLayers`,
  `layersObserved`) or the scenario's split, each lit by the true Sun elevation (a 1 km base is
  in shadow at sunset; cirrus at 10 km stays lit, and pink, until ≈ −3.5°). A thin high veil keeps
  55–85 % of the direct beam. Smoke harness gained `cirrus-sunset` / `stratus-sunset`; new
  contact sheet.
- **"This light" chip** under the timeline: how long the sun keeps returning to its current
  position and when it comes back after that ("Like this until … · Back … 17:47"); one click
  jumps there. `summarizeRecurrence()` in `@lightmap/astronomy` (tested at equinox/solstice);
  Free plans see the answer inside their window and an honest "Beyond your date window · Pro".
- **Error monitoring**: `SENTRY_DSN` enables a dependency-free Sentry-envelope reporter (release,
  environment, redacted context; tests); API 500s and webhook failures are reported; health
  reports the real package version. `docs/RUNBOOKS.md` covers provider outage, Stripe webhook
  failures, database loss/restore, bad release, abuse, data-subject requests, licence issues.
- Light finder: the target ring can be dragged or nudged with the arrow keys.
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

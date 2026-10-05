# Changelog

All notable changes. Versions follow semver; `pnpm release <version>` prepends entries from commits.

## Unreleased

- **Preferences (plan §17)**: an "Account & plan" section — signed in or not — for distances
  (metric or imperial: the depth-of-field figures and focus box, the planning card, weather
  visibility and wind), which zone times are shown in (the place's own or the device's; switching
  keeps the selected instant and re-reads it, and saved viewpoints always carry the place's zone)
  and the lens a new place starts with (8–600 mm full-frame equivalent, saved when the box is
  left). The scene now carries `timeZone` (the zone its clock and day events are read in) apart
  from `location.timeZone` (the place's own, still used for climatology, the finder's place
  data, the card subtitle and saved viewpoints); the weather query is keyed by zone. Kept on the device,
  saved to the profile when signed in (`GET/PATCH /api/account/profile`, `profilesRepo`), the
  profile winning when it loads unless it has never been changed, in which case the device's
  choices are adopted into the account; a failed save rolls back and says so. `formatDistance()`,
  `formatHeight()`, `defaultCamera(eye, heading, lensMm)` in `@lightmap/scene`.
- **Product analytics (plan §31)**: the eight named events are now actually recorded —
  `location_selected` (how the place was chosen, whole-degree buckets), `timeline_scrubbed`
  (steps per rest), `weather_scenario_changed`, `preview_expanded`, `project_created`,
  `viewpoint_saved` (variant or not), `upgrade_started` (interval) from the client as same-origin
  beacons to `POST /api/analytics`, and `subscription_started` (plan key) from the Stripe webhook.
  The route keeps only each event's own, typed properties (anything else is dropped, buckets
  re-rounded), refuses unknown events and bodies over 4 KB, is burst-limited and carries no
  identity; Do-Not-Track and Global Privacy Control stop events on both sides. `ANALYTICS_SINK` (`none` in production by default, `log` in development) picks the
  sink and `capabilities.analytics` tells the client whether to send at all. PRIVACY.md §4 and the
  public privacy page say what each event carries.
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
- **Security**: Vitest 4.1.11+ (GHSA-82fw-gwwq-j7x9, moderate: path traversal via
  `@vitest/mocker` redirect mocks — dev-only, closed anyway); nodemailer 10.0.9+ across the workspace (GHSA-v53p-9fqp-m79j and
  GHSA-prgh-xp8r-p3m5, high: address-parser denial of service; plus three moderate advisories).
  Only `createTransport`/`sendMail` are used, unchanged across the major.
- **Moon accuracy 0.3° → 0.02°**: the lunar position now follows Meeus ch. 47 (abbreviated
  ELP-2000/82: 60 terms in longitude/distance, 60 in latitude, planetary and flattening terms,
  nutation, true obliquity), reproducing Meeus's worked example 47.a to the unit of the published
  sums. Rise/set ±1 min, illumination ±1 %; the accuracy note in the UI says so. Moonrise and
  moonset were ~4 minutes late: the rise threshold applied Meeus's _geocentric_ h0 to an altitude
  that already had parallax removed; it is now −(semidiameter + 34′ refraction) on the
  topocentric altitude, checked by a self-consistency test, and `isAboveHorizon` uses the same
  rule. Parallax is now applied exactly (Meeus ch. 40 topocentric equatorial correction) instead
  of the first-order h − π·cos h, which left up to 0.01° in altitude; hour angles use apparent
  sidereal time (equation of the equinoxes, ≤ 0.005°) for the Sun and Moon alike.
- **Planning card**: with the camera tools, the card carries a "Depth of field" row — the real
  lens on the chosen sensor, aperture, focus distance and the sharp range (hyperfocal when the
  far limit is finite).
- **Install app** in the account menu (Phase 9 "native install"): Chromium's deferred install
  prompt, the Add-to-Home-Screen hint on iOS Safari, hidden when already installed.
- **Roll-aware field view**: the phone's roll about its line of sight (from the orientation
  reading, smoothed) tilts the sun marker, the sun path, the level line and the ridge the other
  way, so a hand-held phone that is not quite level still marks the picture correctly.
  `frameCoordinates()`/`directionFromFrame()` gained an optional roll (round-trip tested),
  `levelLineSegment()`, `cameraPointingFromOrientation().rollDeg`.
- **Light finder: "On the ridge"** — a new target mode with a sampled terrain horizon: type a
  bearing (defaults to the camera heading) and the finder searches for the moments the sun's (or
  moon's) upper limb touches the modelled skyline there — the plan's "every date the sun sets
  behind that ridge". `ridgeContactElevationDeg()` in `@lightmap/scene`, the inverse of
  `aboveTerrain`, tested to ±0.01°.
- **Field view (Phase 9 AR sun alignment)**: on a phone in viewpoint mode, "Field view (camera)"
  shows the live back camera with the planned sun and moon marked, the sun's path for the day,
  true level, the modelled ridge and an edge arrow with the turn needed when the sun is out of
  frame; heading/pitch follow the phone, "Now" jumps to the present, the feed's field of view is
  adjustable. Camera frames never leave the device (`Permissions-Policy: camera=(self)`,
  PRIVACY.md §11). `sunPathInFrame()`, `edgeIndicator()`, `defaultCameraFeedFovDeg()` tested.
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

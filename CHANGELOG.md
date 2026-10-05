# Changelog

All notable changes. Versions follow semver; `pnpm release <version>` prepends entries from commits.

## v0.2.0 — 2026-10-05

- **Milky Way core** (night planning): the Moon details and the planning card say where the
  Galactic Centre stands for the selected instant and whether the sky can show it — "36° up SSW —
  Astronomical night, core 36° up, Moon down" — with one verdict (daylight, twilight, below the
  horizon, moonlit, low, visible) in the order a photographer rules things out; the compass rose
  and the field view mark the core as a four-point star on a dark sky (the field view adds an
  edge arrow when it is out of frame, the core's dotted track over the night's dark hours and
  the Moon's path while it is up — `sampleTrack()`/`projectTrack()`: positions sampled once per
  place and day, projected per frame as the phone turns; tested). The 3D map view draws the
  same two night paths on the overlay sphere beside the day's sun arc (`nightPathsForDay()`,
  tested; dashed grey and violet). `milkyWayCore()`
  / `milkyWayCoreFrom()` in `@lightmap/astronomy`: Sgr A\* precessed from J2000 (Meeus ch. 21),
  the observer's sidereal time, the scene's own Sun and Moon. Not a sky-brightness model (light
  pollution and airglow are not modelled), and the docs say so. **Dark windows ahead**: the Moon
  details list the next nights the core can be shot (≥ 30 min of astronomical night with the
  core 10° up and no Moon over 30 % above the horizon, 45 nights from the selected day's evening,
  edges to the minute and inside the stretch), each a click that jumps the planner to the core's
  peak — or why there are none (no astronomical night, core never up this season, the Moon, or
  only minutes at a time). `milkyWayWindows()`, tested at Kailua, London, the full-Moon nights
  and the grazing cases. The timeline track carries a faint violet **dark-sky band** over the
  night's shootable spells (`darkSkySpells()`/`darkSkyBand()`, tested); the planning card
  lists the next two dark windows; a saved viewpoint planned after dusk carries a night line
  ("✦ Milky Way core 36° up SSW · dark sky", `nightTag()`, tested). The **Light finder** takes the core as a third body: "when does the
  core stand over that peak?" — bearing/elevation matches like the Sun's, kept only in a dark
  sky by default (`darkSkyOnly`; each match says `dark`, `daylight`, `twilight` or `moonlit`).
- **Archive projects**: a project can be archived and restored (`archivedAt`, `PATCH
/api/projects/:id {archived}`, `GET /api/projects?archived=1`); archived projects are kept
  with their viewpoints, hidden from the active list and — with their viewpoints — not counted
  toward the plan's limits, so a Free account can shelve a finished shoot and start the next; an
  archived project takes no new viewpoints (409) until restored. Integration-tested; E2E.
- **Shot list**: a project exported as plain text to copy or download — the call sheet for the
  day, one block per viewpoint in time order (variants under their parent) with the camera, the
  Sun, the day's sunrise/sunset, the Moon and the Milky Way core for night shots, the weather
  basis it was saved with and the project notes (`buildShotList()`, tested; Pro export). Each
  block carries a `/?viewpoint=<id>` link that reopens the viewpoint for its owner
  (`useViewpointLink`; the drawer's "Open" and the link share `restoreInputFor()`, tested).
- **Project notes and shoot date** are editable in place from the selected project (plan §4
  "Projects: name, optional shoot date, notes" — the API had them, the UI did not): notes save on
  blur or Ctrl/⌘+Enter, the date once it has settled, chained so the last edit wins, with an
  honest saved/unsaved status.
- **Dark-hours climatology**: "Typical for this month" adds the night shooter's line — how
  often the dark hours of the selected night (astronomical dusk to dawn) were clear over ten
  years, mean cloud and the overcast/storm share (`hoursShare()`, `hoursBetween()`, tested).
- **Day-of-year slider** under the date control: scrub the seasons the way the timeline scrubs
  the day — the date moves, the time of day stays (plan §44 "scrub through days, months, and
  seasons"); `lib/civil-year.ts`, tested across the leap day. The weather fetch and the
  night-sky scans wait for the date to settle (300 ms), so a drag costs no requests.
- **Checkout return**: `/account?checkout=success` now watches for Stripe's confirmation (the
  entitlement snapshot is re-read every two seconds for up to a minute) and switches from "being
  activated" to "You're on Pro — everything is unlocked" with a link back to the map, or says
  plainly that confirmation has not arrived (plan §38: the existing plan unlocks at once).
- **Moon phase calendar**: the Moon details list the next four principal phases from the selected
  day (New, First quarter, Full, Last quarter, as dates in the planning zone). `nextMoonPhases()`
  in `@lightmap/astronomy` bisects the elongation from the same Meeus series as the positions —
  the published 2026 instants (3 Jan full 10:03, 18 Jan new 19:52, 31 May full 08:45, 15 Jun new
  02:54 UTC) come out within two minutes.
- **"Tonight"** beside "Now": today at the start of astronomical night at the place (`setTonight`,
  tested).
- **Timeline marker labels no longer pile up**: dawn, sunrise and golden hour (or golden hour,
  sunset and dusk) sit minutes apart and their words overlapped in the panel; labels now fit the
  measured track — words where they clear each other, glyphs on a second row where they do not,
  a bare tick where even that would touch; sunrise and sunset keep their words first
  (`markerLabels()`, tested).
- **Fixes from the first browser pass**: picking a location crashed the page in development
  (React's StrictMode replays effects into a torn-down Cesium scene — the stale apply is now
  dropped and `setAtmosphere` tolerates a scene without a globe); without a database the
  session endpoint logged an Auth.js `ClientFetchError` on every load (it now answers signed-out
  like Auth.js does); `GET /api/projects` failed on Postgres (a bare `Date` in a SQL template —
  the window bounds now go through the column mapping; this was the CI integration failure);
  choosing a place searched for its own label and reopened the result list over the map.
- **Play the day**: a play/pause button beside the timeline clock runs the day by itself at 2, 10
  or 60 day-minutes per second (the pace button cycles them, mid-play too) and starts over at
  midnight — a sunset watched, not scrubbed; the clock waits while the thumb is held and
  continues from the drop point; a hidden tab does not make it leap (`usePlayDay`, `advance()`,
  tested; play, pause and pace in the E2E).
- **Forecast horizon stated as lead, not as the provider's day count**: Open-Meteo's 16 forecast
  days include today, so the last day it serves is today + 15 — the declared horizon is now
  15 × 24 h (the extended band is days 8–15) and a forecast request's `end_date` is clamped to
  that last day, so a civil day running past it in UTC (any zone west of Greenwich) is cut
  rather than refused (tested).
- **Shoot countdown on project cards**: "Shoot 24 Oct · in 19 days · forecast from 9 Oct" —
  civil days to the shoot date and where the provider's forecast stands for it ("extended
  forecast available" once the whole day is within reach, green "forecast available" once it is
  inside the reliable horizon — the planner's own rule, so the card agrees with the viewpoint
  nudges; `shootCountdown()`, tested; E2E).
- **Field conditions in the weather details**: the wind with the quarter it blows from ("4 m/s
  from the ENE", "calm"), the humidity, and visibility in sensible units ("600 m", "4.5 km",
  "24 km"); notes when there is something to act on — a fresh breeze and up ("weigh the tripod
  down; clouds streak in a long exposure" → "tripod shake likely" → "a weighted tripod in a lee at
  best" → "hand-held only"), fog ("lenses mist within minutes"; rain or snow cutting the view is
  not called fog), dew likely at ≥ 95 % humidity after sunset (mist in the air by day), dew
  possible on a calm, mostly clear night from 85 % (`fieldConditions()`, Beaufort's bands and the
  WMO fog threshold, tested). Scenario days say nothing: there is no frame. The planning card
  carries the same line ("In the field") and its notes on forecast and observed days, and the
  hourly outlook names the hours at ≥ 95 % humidity and ≥ 8 m/s wind as runs ("Humidity ≥ 95 %
  02:00–06:00 (dew or mist on the glass) · wind ≥ 8 m/s 13:00–17:00 (weigh the tripod)";
  `humidHours`, `windyHours`, tested).
- **Dark-sky cloud in the hourly outlook**: a line with the forecast cloud over the night's
  dark-sky spells and the clearest hour — "is the core window going to be clear?"
  (`cloudOverSpells`, tested).
- **"Why does it look like this?" at night** names the Moon as the only direct light (or its
  absence) and the Milky Way core with its verdict (`explainScene`, tested).
- **Light windows with their lengths** in the Sun & moon details: "Golden hour 05:33–06:20 (47
  min) · 18:37–19:24 (47 min); blue hour 05:23–05:33 (10 min) · …" in the package's bands
  (golden −4°…+6°, blue −6°…−4°), sampled over the day so midnight-sun and polar-twilight
  windows are listed too (`describeLightWindows()`, tested at Kailua, Tromsø, Oslo and in polar
  night). The planning card's blue hour now uses the same band.
- **Night on the timeline**: ☆ / ★ markers where astronomical night ends and begins (plan §4's
  "night" marker), beside dawn and dusk.
- **Moonrise and moonset on the timeline** (moon planning): grey ☾ / ☽ markers beside the sun's,
  clickable like them; only instants inside the civil day are placed.
- **Forecast nudges on saved viewpoints**: a project card counts the viewpoints now inside the
  reliable forecast window ("◉ 2 inside the forecast window", `upcomingViewpointCount` from the
  list query); a viewpoint card whose date has come inside the forecast horizon
  since it was saved says "◉ Forecast available now — open to see it" (or the extended-range
  wording), and a passed date says observed conditions are there — the North Star's "return later
  and see the forecast become more specific", from the planner's own horizon rule
  (`forecastNudge()`, tested).
- **Moon on the compass rose**: when the Moon is up, the sun-direction overlay marks it as a grey
  disc (brighter the fuller it is) on the same dome, and the overlay's description names its
  bearing, elevation and illumination.
- **Seasonal envelope** (plan §1 "seasonal path"): the compass rose shows where sunrise and
  sunset swing to across the year as rim arcs (June to December solstice), the 3D map draws the
  two solstice sun paths faintly beside the day's arc, the planning card carries the line, and
  "Sun & moon details" reads the bearings and the noon range out ("Sunrise 64°–115° (ENE–ESE)
  …"); polar places name the solstice condition instead. `seasonalEnvelope()` in `@lightmap/scene`, tested
  at London, Kailua, Sydney and Tromsø.
- **Observed weather for any past date**: dates beyond the forecast model's 92-day window now
  load real conditions from the provider's reanalysis archive (Open-Meteo ERA5 back to 1940;
  `archiveDays` capability, computed from that date) — labelled "Observed · reanalysis" at MEDIUM confidence (coarse grid,
  no visibility), never a forecast, cached 30 days. Dates older than any archive stay a labelled
  scenario, as before. `WEATHER_AND_FORECAST_MODEL.md` §2/§6/§7.
- **Water (Phase 4)**: the terrain water mask is requested and Cesium's water effect is on, so
  sea and lakes carry a specular glint from the scene light and a ripple normal map where the
  tile set has a mask (Cesium World Terrain); providers without one are unchanged.
- **Production smoke test** (plan §43): `pnpm smoke:prod <url>` checks a deployed build — health
  and the tagged version, no fixture mode, the security headers and a CSP without `unsafe-eval`,
  capabilities without a dev banner or dev sign-in, manifest and an uncacheable service worker,
  the privacy page's placeholders, and that the profile route answers 401 and an unsigned Stripe
  event 400 — as pure, unit-tested checks (`evaluateSmoke` in `@lightmap/observability`);
  `release.yml` runs it after the deploy in place of the bare health curl.
- **Sky from physics (Phase 4)**: the clear-sky colours of the overlay gradient, the preview chrome
  and the planning card now come from a single-scattering Rayleigh + Mie model
  (`skyRadiance()`, `clearSkyStops()` in `@lightmap/renderer`): a blue overhead and a pale
  horizon that pale further with the scenario's haze and a lower Sun, and a sunrise/sunset glow
  whose hue follows the Sun's elevation and the haze. Blended into the hand-set colours (60 % by
  day, none near the horizon; twilight and night unchanged) since single scattering has no
  multiple scattering or ozone. Cesium's own dome is unchanged by default; behind the new
  `physicalSkyDome` feature flag its aerosol density follows the scenario's haze through the
  model's Mie coefficient, with a `storm-physical-dome` shot in the renderer smoke harness to
  judge it. Eight tests pin the physics (Rayleigh ordering, horizon paling, sunset reddening,
  haze, Earth shadow, symmetry, exposure anchor).
- **Dev perf panel** completes plan §27: draw commands (Cesium's per-frame command list) and the
  WebGPU API flag beside FPS, terrain tiles, WebGL2/GPU and the weather-cache state.
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

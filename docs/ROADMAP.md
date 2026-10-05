# Roadmap

Phases follow the master plan (§25). Status as of v0.1.0. A phase is "delivered" when its listed
items exist, are tested and are documented; "plumbing" means the code paths work end to end in test
mode but production configuration is still outstanding.

| Phase | Goal                                        | Status                                                                                            |
| ----- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 0     | Foundation                                  | **Delivered in v0.1.0**                                                                           |
| 1     | Lighting MVP                                | **Delivered in v0.1.0**                                                                           |
| 2     | Weather                                     | **Delivered in v0.1.0**                                                                           |
| 3     | Accounts, projects, billing                 | **Delivered as plumbing in v0.1.0**; production configuration outstanding                         |
| 4     | Visual quality                              | Started: export, twilight/haze, layered clouds delivered (unreleased)                             |
| 5     | Real references                             | Future — blocked on licensing                                                                     |
| 6     | Advanced camera planning / reverse planning | **Solver, Light finder, point-in-view, variants, "this light" chip, DOF, levelling (unreleased)** |
| 7     | Long-range climatology                      | **Delivered (unreleased)** — Open-Meteo/ERA5, Pro entitlement                                     |
| 8     | High-fidelity environment reconstruction    | Future                                                                                            |
| 9     | Native mobile                               | Started — PWA installable baseline and offline project cache (unreleased); native later           |

## Phase 0 — Foundation (delivered)

pnpm workspaces + Turborepo monorepo; Next.js app shell; ESLint, Prettier, TypeScript strict
(`erasableSyntaxOnly`, `verbatimModuleSyntax`); Vitest, Playwright; GitHub Actions CI, security and
release workflows; dependency-free env validation; SQL migration runner with checksums; licence
allowlist and `THIRD_PARTY_NOTICES.md` generation; secrets scan; bundle budget; core documentation;
WorldView reuse audit (`WORLDVIEW_REUSE_AUDIT.md`).

## Phase 1 — Lighting MVP (delivered)

Cesium globe via `@cesium/engine`; location search, map click, coordinate paste, device location;
time-zone resolution; date and timeline controls with day-event markers and keyboard support;
`packages/astronomy` (sun, moon, twilight, golden/blue hour) validated against USNO; sun and shadow
direction overlays; camera heading/pitch/lens presets in map and viewpoint modes; terrain preview
with `DirectionalLight` driven by `SolarState`; Clear / Mostly Clear / Partly Cloudy / Overcast /
Storm scenarios through a post-process grade; responsive mobile sheet; source and confidence labels;
Quality-0 overlay fallback; dev performance panel.

Acceptance: Kailua Beach, 31 May 2026, 12:30 HST shows sun ≈ 89.3°, sunrise 05:48, sunset 19:09,
scenario-labelled weather, and visibly different scenarios (E2E `planner.spec.ts`).

## Phase 2 — Weather (delivered)

`WeatherProvider` abstraction with capabilities; normalised `WeatherFrame`; Open-Meteo adapter
(hourly cloud layers, visibility, precipitation, irradiance, 16-day horizon, 92-day archive);
horizon decision (`FORECAST` / `EXTENDED_FORECAST` / `SCENARIO` / `RECENT_PAST` / `PAST`);
forecast badge with confidence; one fetch per 0.05° grid cell per civil day cached in
`provider_cache`; client-side interpolation while scrubbing; scenario fallback outside the horizon
and on provider failure; "compare scenario" pinning inside the window; fixture provider for
development and tests, refused in production.

## Phase 3 — Accounts, projects, billing (plumbing delivered)

Delivered: Auth.js with magic-link email, optional Google, dev sign-in (non-production only);
projects and viewpoints with owner-scoped repositories and entitlement-checked limits; Stripe
Checkout and Customer Portal routes; idempotent webhook pipeline; central entitlement derivation
and `GET /api/account/entitlements`; usage counters and daily budgets; account-deletion request;
legal placeholders wired into the app; profile preferences (units, time-zone mode, default lens;
`GET/PATCH /api/account/profile`, kept on the device when signed out); product analytics (plan
§31: the eight named events as same-origin beacons to `/api/analytics`, sanitised server-side,
`ANALYTICS_SINK` off in production by default, Do-Not-Track and Global Privacy Control honoured).

Outstanding before commercial beta (plan §43):

- production Auth.js configuration (email server or Google credentials, `AUTH_SECRET`, `AUTH_URL`);
- Stripe live keys, live prices, webhook endpoint registered on the production URL;
- Open-Meteo commercial API subscription (or another approved provider);
- commercial geocoder contract (Nominatim is development-only);
- terrain/imagery licensing sign-off and complete attribution UI review;
- ~~error monitoring DSN~~ (`SENTRY_DSN`, dependency-free envelope reporter); ~~cost telemetry~~ (`pnpm usage:report`, `COST_MODEL.md` §7) — a hosted dashboard when there is a host;
- ~~scheduled retention job~~ (`retention.yml`, needs the production `DATABASE_URL` secret); the
  sign-in-cancels-deletion path exists;
- ~~privacy policy and terms text~~ (full drafts at `/legal/privacy` and `/legal/terms`, derived
  from `PRIVACY.md` and the product spec; counsel review and the bracketed items — entity,
  governing law, liability cap, refunds — still outstanding); ~~mobile usability pass~~ (code pass done: 16 px fields, safe
  areas, swipe handle, glance line, touch slop — device QA on real phones per `QA_PLAN.md`
  still to run); backups verified on the host;
  ~~incident runbooks~~ (`RUNBOOKS.md`); ~~end-to-end production smoke test~~ (`pnpm smoke:prod`,
  run by `release.yml` after the deploy; host still to come).

## Phase 4 — Visual quality (started, 2+ releases)

Delivered (unreleased): **preview export** — the planning card (`PRODUCT_SPEC.md` §5);
**horizon haze** (aerial perspective by depth and Sun elevation); **twilight/blue-hour sky**
correction and a low-Sun dome lift; textured overcast decks; **layered clouds** — low / mid / high
decks from the forecast's own cloud layers (or the scenario's split), each lit by the true Sun
elevation so cirrus stays pink after sunset while a stratus deck goes dark; **shadow quality** —
no low-Sun fade, camera-aware reach, and a measured shadow probe in the smoke harness
(`RENDERING_ACCURACY.md`).

Also delivered (unreleased): **device conditions** — the quality governor's ceiling follows the
battery (draining and ≤ 50 % → Balanced at best; ≤ 20 % → Battery) and Save-Data /
`prefers-reduced-data` (Balanced) while the app runs; shadows are never switched off by
conditions (`conditionsCeiling`, `effectiveCeiling`, `watchDeviceConditions`).

Also delivered (unreleased): a **single-scattering Rayleigh + Mie sky model** (`sky-model.ts`)
behind the sky gradient of overlay mode, the preview chrome and the planning card — the blue
overhead, its paling with haze and the hue of the sunrise/sunset glow come from the geometry and
the scenario; hand-set colours remain for twilight, night and the daytime horizon
(`RENDERING_ACCURACY.md`).

Also delivered (unreleased): **water** — the terrain water mask is requested and Cesium's water
effect shades sea and lakes with a specular glint from the scene light and a ripple normal map
(`RENDERING_ACCURACY.md` "Water"); no swell geometry or sky reflection.

Remaining: improved terrain texture; detailed buildings where licensed; the scattering model in
Cesium's own dome (the haze → Mie wiring is in behind the `physicalSkyDome` flag with a
smoke-harness shot to judge it; enabling it is the PC's call); a fuller water shader (waves, sky
reflection) is not planned until Phase 8. Everything stays grounded: geometry and light direction are
never altered for looks.

## Phase 5 — Real references (future, requires licensing work)

`ImageryProvider` interface already exists in shape (`REFERENCE_IMAGERY_PROVIDER=none`). Deliver a
licensed provider integration, near-coordinate lookup, capture metadata, attribution, and a
side-by-side real vs simulated view. Does not start until commercial rights are documented in
`DATA_SOURCES_AND_LICENSING.md`.

## Phase 6 — Advanced camera planning (in progress)

Delivered (unreleased): the **reverse-planning solver** (`findDirectionMatches` in
`@lightmap/astronomy`, tested at equinox/solstice/polar/tropical cases) and the **Light finder**
panel — target from the centre of the viewpoint frame, the body's current position or typed values;
sun or moon with an illumination floor; date range clipped to the plan window for Free; results jump
the planner to the instant (`PRODUCT_SPEC.md` §8a). Entitlement `reverse_planning`.

Also delivered: **point in the view** — click the spot in the viewpoint preview where the sun or
moon should be (`directionFromFrame()`, the inverse of `frameCoordinates()`, round-trip tested);
a ring marks the pick and follows the camera.

Also delivered: **shot variants** per viewpoint (migration 0003, one level, cascade, counted
toward limits; `PRODUCT_SPEC.md` §9).

Also delivered: **sensor formats** ("Your camera": sensor preset + the lens number as printed).

Also delivered: the ring is draggable / keyboard-nudgeable.

Also delivered: the **"this light" chip** under the timeline — how long the current sun
position lasts and when it comes back, one click to jump there (`summarizeRecurrence()`,
`PRODUCT_SPEC.md` §8a).

Also delivered: the **terrain horizon** — "when does the sun clear the ridge?" (sampled through
the renderer from the DEM; "Sun behind terrain" badge, ridge markers on the timeline, first/last
light over terrain, finder tags; `PRODUCT_SPEC.md` §8b).

Also delivered: the finder's **"On the ridge"** target — the sun's upper limb touching the
modelled skyline at a bearing, i.e. "every date the sun sets behind that ridge" (plan §26's
example), from `ridgeContactElevationDeg()` (inverse of `aboveTerrain`, tested).

Also delivered: **depth of field** in "Your camera" — aperture and focus distance give near/far
limits for the real lens on the chosen sensor, whether the horizon is sharp, and a one-click
hyperfocal focus (`depthOfField()` in `@lightmap/scene`, textbook cases tested).

Also delivered: **horizon levelling** — a level & thirds guide in the viewpoint view with the
true-level line, the modelled skyline and one-click horizon placement on a third
(`levelLineY`, `pitchForHorizonAt`, `skylinePath`; tested against `frameCoordinates`).

Also delivered: the **seasonal envelope** — the year's sunrise/sunset bearings and noon range
from the two solstices, as rim arcs on the compass rose and a line in the sun details
(`seasonalEnvelope()`; plan §1 "seasonal path").

Also delivered: **night planning** — the Moon on the compass rose, moonrise/moonset on the
timeline, the next four principal phases, and the **Milky Way core**: where the Galactic Centre
stands and one verdict on whether the sky can show it (daylight / twilight / below the horizon /
moonlit / low / visible; `milkyWayCore()` in `@lightmap/astronomy`, in the Moon details and on
the planning card), and the **dark windows ahead** — the next nights the core can be shot, each a
click away (`milkyWayWindows()`). Geometry only — no sky-brightness or light-pollution model.

Also delivered: **camera roll in the frame maths** (`frameCoordinates`/`directionFromFrame`
optional roll, `levelLineSegment`, roll from the device orientation) — used by the field view
so a hand-held phone's tilt is honoured. The planner's saved camera stays roll-free; a rolled
3D preview (Cesium camera roll) remains future.

## Phase 7 — Long-range climatology (delivered, unreleased)

"Typical for this month" beside the scenario buttons: shares of the five scenario classes over
daylight hours across the last ten years (ERA5 via Open-Meteo's archive, `ClimatologyProvider`
abstraction with a fixture), mean cloud and wet-day fraction, tap-to-compare, most-common marker.
Never labelled a forecast, never above SCENARIO confidence (`WEATHER_AND_FORECAST_MODEL.md` §8).
Pro entitlement `climatology`; cached 30 days per 0.5° cell. Also delivered: the **hour-of-day
breakdown** (24 bars, clearest/cloudiest stretch, table alternative). Future: haze/visibility
climatology once a source with those fields is licensed.

## Phase 8 — High-fidelity environment reconstruction (future)

Commercial 3D tiles, photogrammetry, Gaussian splats, NeRF-derived assets, physically based
atmosphere, and controlled generative enhancement that may denoise, upscale and add micro-detail but
must not relocate terrain, change horizon geometry, invent buildings, move the sun, change shadow
direction or erase uncertainty labels.

## Phase 9 — Native mobile (future)

The PWA baseline exists (unreleased): a complete manifest (`id`, scope, 192/512 PNG icons plus a
maskable variant, `display_override`), an apple-touch-icon, `start_url=/?source=pwa` so installed
launches can be counted, and an **Install app** entry in the account menu (deferred
`beforeinstallprompt` on Chromium; the "Share → Add to Home Screen" hint on iOS Safari; hidden
once installed — `useInstallPrompt`).

**Offline project cache — delivered (unreleased)**, the first Phase 9 deliverable: a hand-written
service worker (`public/sw.js`, production only) keeps the planner page, its hashed chunks, the
icons and the signed-in user's own projects, viewpoints, session and entitlements, so saved plans
open in the field with no signal. It never caches third-party map, terrain or weather data, never
delays a live response (caching happens after the page has it), and drops user data on sign-out,
account deletion, a signed-out session or a change of user. The network banner says when cached
data is on screen and how old it is. Terrain and weather still need the network; offline, weather
falls back to scenarios and the globe to the overlay.

**Compass / device orientation — delivered (unreleased)**: "Point with phone" in viewpoint mode
aims the camera where the phone's back camera points (`cameraPointingFromOrientation`,
`blendHeading`, `useCompass`), the first piece of field mode.

**AR sun alignment — delivered (unreleased)**: the field view puts the planned sun, its path for
the day, true level and the modelled ridge over the phone's live camera, with an edge arrow when
the sun is out of frame (`sunPathInFrame`, `edgeIndicator`, `defaultCameraFeedFovDeg`;
`FieldView`). Frames never leave the device.

Capacitor or React Native wrapper only after PWA usage proves demand: native install, a native
camera with a known field of view, full field mode.

## Not on the roadmap (plan §37)

Social feed · follower system · likes · comments · user photo uploads · public photo submissions ·
crowdsourced image ingestion · generic AI chat · photographer marketplace · equipment marketplace ·
location recommendation feed · "find me a cool waterfall" discovery engine · complex team admin ·
desktop native wrapper · separate iOS and Android codebases · server GPU render farm · custom
weather model · custom global map tile infrastructure · ads.

# Roadmap

Phases follow the master plan (§25). Status as of v0.1.0. A phase is "delivered" when its listed
items exist, are tested and are documented; "plumbing" means the code paths work end to end in test
mode but production configuration is still outstanding.

| Phase | Goal                                        | Status                                                                                      |
| ----- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0     | Foundation                                  | **Delivered in v0.1.0**                                                                     |
| 1     | Lighting MVP                                | **Delivered in v0.1.0**                                                                     |
| 2     | Weather                                     | **Delivered in v0.1.0**                                                                     |
| 3     | Accounts, projects, billing                 | **Delivered as plumbing in v0.1.0**; production configuration outstanding                   |
| 4     | Visual quality                              | Started: export, twilight/haze, layered clouds delivered (unreleased)                       |
| 5     | Real references                             | Future — blocked on licensing                                                               |
| 6     | Advanced camera planning / reverse planning | **Solver, Light finder, point-in-view, variants, "this light" chip delivered (unreleased)** |
| 7     | Long-range climatology                      | **Delivered (unreleased)** — Open-Meteo/ERA5, Pro entitlement                               |
| 8     | High-fidelity environment reconstruction    | Future                                                                                      |
| 9     | Native mobile                               | Future — PWA installable baseline shipped; demand measured first                            |

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
legal placeholders wired into the app.

Outstanding before commercial beta (plan §43):

- production Auth.js configuration (email server or Google credentials, `AUTH_SECRET`, `AUTH_URL`);
- Stripe live keys, live prices, webhook endpoint registered on the production URL;
- Open-Meteo commercial API subscription (or another approved provider);
- commercial geocoder contract (Nominatim is development-only);
- terrain/imagery licensing sign-off and complete attribution UI review;
- ~~error monitoring DSN~~ (`SENTRY_DSN`, dependency-free envelope reporter); ~~cost telemetry~~ (`pnpm usage:report`, `COST_MODEL.md` §7) — a hosted dashboard when there is a host;
- ~~scheduled retention job~~ (`retention.yml`, needs the production `DATABASE_URL` secret); the
  sign-in-cancels-deletion path exists;
- privacy policy and terms text; ~~mobile usability pass~~ (code pass done: 16 px fields, safe
  areas, swipe handle, glance line, touch slop — device QA on real phones per `QA_PLAN.md`
  still to run); backups verified on the host;
  ~~incident runbooks~~ (`RUNBOOKS.md`).

## Phase 4 — Visual quality (started, 2+ releases)

Delivered (unreleased): **preview export** — the planning card (`PRODUCT_SPEC.md` §5);
**horizon haze** (aerial perspective by depth and Sun elevation); **twilight/blue-hour sky**
correction and a low-Sun dome lift; textured overcast decks (`RENDERING_ACCURACY.md` §Sky).

Remaining: improved terrain texture; detailed buildings where licensed; physically based
atmospheric scattering; water shader; layered clouds; shadow quality; better device performance
adaptation. Everything stays grounded: geometry and light direction are never altered for looks.

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

Next: DOF and horizon levelling remain future.

## Phase 7 — Long-range climatology (delivered, unreleased)

"Typical for this month" beside the scenario buttons: shares of the five scenario classes over
daylight hours across the last ten years (ERA5 via Open-Meteo's archive, `ClimatologyProvider`
abstraction with a fixture), mean cloud and wet-day fraction, tap-to-compare, most-common marker.
Never labelled a forecast, never above SCENARIO confidence (`WEATHER_AND_FORECAST_MODEL.md` §8).
Pro entitlement `climatology`; cached 30 days per 0.5° cell. Future: per-hour-of-day breakdown and
haze/visibility climatology once a source with those fields is licensed.

## Phase 8 — High-fidelity environment reconstruction (future)

Commercial 3D tiles, photogrammetry, Gaussian splats, NeRF-derived assets, physically based
atmosphere, and controlled generative enhancement that may denoise, upscale and add micro-detail but
must not relocate terrain, change horizon geometry, invent buildings, move the sun, change shadow
direction or erase uncertainty labels.

## Phase 9 — Native mobile (future)

The PWA baseline exists (unreleased): a complete manifest (`id`, scope, 192/512 PNG icons plus a
maskable variant, `display_override`), an apple-touch-icon, `start_url=/?source=pwa` so installed
launches can be counted. No service worker yet — the app needs the network for terrain and weather;
an offline project cache is the first Phase 9 deliverable. Capacitor or React Native wrapper only
after PWA usage proves demand: native install, offline project cache, compass, device orientation,
AR sun alignment, field mode.

## Not on the roadmap (plan §37)

Social feed · follower system · likes · comments · user photo uploads · public photo submissions ·
crowdsourced image ingestion · generic AI chat · photographer marketplace · equipment marketplace ·
location recommendation feed · "find me a cool waterfall" discovery engine · complex team admin ·
desktop native wrapper · separate iOS and Android codebases · server GPU render farm · custom
weather model · custom global map tile infrastructure · ads.

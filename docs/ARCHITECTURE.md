# Architecture

LightMap is a TypeScript monorepo: one Next.js web application and twelve packages that each own
one concern. Every external service sits behind an interface; every visual value flows through a
single `SceneState`. This document is the map of the code and the data flow from pin to pixels.

## Repository layout

```
apps/web                  Next.js 15 (App Router). UI, API routes, auth entry point.
packages/config           Brand config, env validation, feature flags.        (pure)
packages/geospatial       Coordinates, provider interfaces + registry, fixtures, Nominatim, terrain/basemap sources.
packages/astronomy        Sun/moon ephemeris, day events, zone conversion.     (pure, USNO-validated)
packages/weather          WeatherFrame model, Open-Meteo + fixture providers, horizon, scenarios.
packages/scene            SceneState builder, confidence, camera model, explanation. (pure)
packages/renderer         Sun vector math, lighting parameters, quality governor, Cesium host + controller, grade shader.
packages/entitlements     Plans → entitlements; can().                        (pure)
packages/database         Drizzle schema, SQL migrations + runner, ownership-scoped repositories.
packages/billing          Stripe webhook processing (pure core) + the only Stripe SDK import.
packages/auth             Auth.js configuration behind AccountService.
packages/observability    JSON logger, error reporter, privacy-safe analytics, budget constants.
packages/ui               Design tokens + small primitives.
scripts/                  Licence gate, attribution gate, env validation, secrets scan, seed, bundle budget, release.
docs/                     This documentation and the ADRs.
```

"Pure" packages have no I/O and run identically in the browser, in Node and in tests. They are
where the product's correctness lives.

## Data flow: pin → astronomy → weather → renderer

```
 user selects coordinate ─┐
 (search / tap / paste /  │
  device / saved)         ▼
                 /api/location/reverse ──► place label · IANA zone (geo-tz) · elevation
                          │
                          ▼
              usePlannerStore  {location, date, minutes, scenario, camera}
                          │
                          ▼  selectedUtc()  (wall clock in the location's zone → UTC)
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
 @lightmap/astronomy                 /api/weather (once per 0.05° cell per civil day)
 SolarState · LunarState ·           └─► WeatherFrame[] cached in provider_cache, interpolated locally
 DayEvents  (client, <1 ms)                 │
        │                                    ▼
        │                     decideWeatherMode(utc, now, capabilities)
        │                     FORECAST / EXTENDED / SCENARIO / RECENT_PAST / PAST
        │                                    │
        └───────────────┬────────────────────┘
                        ▼
              buildSceneState()  (packages/scene/src/build.ts — the ONLY combination point)
              ┌──────────────────────────────────────────────────────────────┐
              │ location · localTime · utc · camera · solar · lunar          │
              │ dayEvents · atmosphere{mode, scenario, frame, parameters,    │
              │ colourTemperatureK} · environment · sourceMode · confidence  │
              │ · render                                                     │
              └──────────────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────────────────────┐
        ▼               ▼                               ▼
 lightingFromScene()  UI components read it       explainScene()
 sun ECEF vector,     (badges, panels, timeline)  "why does it look like this?"
 colour, intensity,
 shadow darkness,
 atmosphere shifts,
 grade uniforms,
 sky gradient
        │
        ▼
 SceneController.apply()  ──► SceneHost (CesiumSceneHost)  ──► WebGL
   cheap per tick: time, light, atmosphere, grade, camera, overlay
   debounced: terrain SSE, resolution scale, ground height
```

Two rules make this trustworthy:

1. **Nothing combines astronomy, weather and camera except `buildSceneState`.** Components never
   compute a colour from an elevation or a badge from a horizon; they read fields.
2. **The renderer consumes SceneState and nothing else.** The 3D view and the 2D overlay are two
   projections of the same numbers, so they cannot disagree.

## The renderer

`packages/renderer` splits into pure math and a thin Cesium layer:

- `sun-vector.ts` — azimuth/elevation → ENU → ECEF. `DirectionalLight.direction` is the direction
  light _travels_, so it is the negation of "toward the Sun". Unit tested at the equator, the pole,
  and by round trip.
- `lighting.ts` — SceneState → intensities, tints, shadow darkness, atmosphere shifts, fog density,
  grade uniforms and a CSS sky gradient. Direct light fades in from −0.833° and is multiplied by
  scenario `sunTransmittance`; shadows are disabled when there is no meaningful direct light.
- `quality-governor.ts` — FPS → rung on a monotone quality ladder (shadow map size, soft shadows,
  terrain screen-space error, resolution scale). Steps down fast, up slowly, penalises oscillation.
- `capabilities.ts` — WebGL2 probe; no WebGL2 ⇒ `OVERLAY` mode (Quality 0).
- `cesium/host.ts` — `SceneHost`, the narrow interface the controller drives.
- `cesium/controller.ts` — diffs and debounces; computes the day's sun-path overlay; converts
  horizontal FOV to Cesium's frustum convention in portrait.
- `cesium/cesium-host.ts` — the one file typed against `@cesium/engine`: CesiumWidget with globe
  lighting on, `scene.light = DirectionalLight`, `Atmosphere.dynamicLighting = SCENE_LIGHT`, shadow
  map, post-process grade stage, terrain/imagery providers with Natural Earth II fallback, pick,
  ground-height sampling, thumbnails.
- `shaders/grade.frag.ts` — the weather scenario as a post-process: procedural clouds over sky
  pixels (depth == far), haze with distance, contrast/saturation/tint, rain streaks. It never moves
  geometry or the light.

Why our own `DirectionalLight` instead of Cesium's `SunLight`: one source of truth. The UI shows
the azimuth/elevation from `@lightmap/astronomy`; the scene is lit by the same numbers. Cesium's
own ephemeris is read back in the dev perf panel as a consistency check (Δ typically < 0.5°).

## Time

All selections are wall-clock times _at the location_. `packages/astronomy/src/time.ts` converts
with `Intl` and a documented DST policy (gap → shift forward, overlap → earlier instant), so
"12:30" means 12:30 at Kailua whichever zone the user's device is in. The civil day is bounded by
local midnights, so day events belong to the calendar date the photographer means — including
23-hour DST days and UTC+14.

## Server

Next.js route handlers under `apps/web/app/api`. `lib/server/services.ts` builds one container per
process from the validated env: providers, weather, billing, db, logger. Routes:

| Route                                                                       | Purpose                                                                         | Cache / limits                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/scene/capabilities`                                               | Credential-free provider descriptors, weather capabilities, flags, auth methods | 5 min private                                                                         |
| `GET /api/location/search?q=`                                               | Place search (coordinates parsed locally first)                                 | burst 30/min, daily geocoder budget, cache by normalised query                        |
| `GET /api/location/reverse?lat&lng`                                         | Label + IANA zone + elevation                                                   | cache by 0.01° cell, 30 days                                                          |
| `GET /api/solar/day?lat&lng&date&tz`                                        | Day events (also computed client-side)                                          | public 1 day                                                                          |
| `GET /api/weather?lat&lng&date&tz`                                          | One civil day of hourly frames for the 0.05° cell                               | 422 outside horizon; burst 30/min; daily budget; cache TTL = provider update interval |
| `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`              | Projects                                                                        | ownership in WHERE                                                                    |
| `POST /api/projects/:id/viewpoints`, `GET/PATCH/DELETE /api/viewpoints/:id` | Viewpoints + latest snapshot                                                    | entitlement checks                                                                    |
| `GET /api/account/entitlements`                                             | Server-derived plan snapshot                                                    | no-store                                                                              |
| `POST /api/account/delete`                                                  | Deletion request (14-day window)                                                |                                                                                       |
| `POST /api/billing/checkout`, `POST /api/billing/portal`                    | Stripe sessions                                                                 |                                                                                       |
| `POST /api/webhooks/stripe`                                                 | Signature-verified, idempotent                                                  |                                                                                       |
| `GET /api/health`                                                           | Liveness + db check                                                             |                                                                                       |

Without `DATABASE_URL` the app still runs: exploration, astronomy and forecasts work; accounts,
projects and billing report themselves unavailable.

## Client state

`usePlannerStore` (Zustand) holds what the user chose. TanStack Query holds server data
(capabilities, weather frames, account, projects). `useScene()` derives `SceneState` from both on
every change; the timeline can fire dozens of times a second because the derivation is
sub-millisecond and weather is interpolated from cached frames.

## Provider abstraction

`GeocodingProvider`, `TimezoneProvider`, `TerrainProvider`, `MapTileProvider`, `BuildingProvider`,
`ImageryProvider` (geospatial) and `WeatherProvider` (weather). Each carries `ProviderMeta`:
attribution, licence, terms URL, commercial review state, fixture flag, cache policy. The registry
picks implementations from env; the client only ever receives `publicDescriptors()` — never keys.
`scripts/check-attribution.ts` fails CI if a provider id lacks a row in
`DATA_SOURCES_AND_LICENSING.md`.

## Testing strategy

Pure packages: Vitest unit tests, including a USNO golden set for astronomy. Renderer: math tests
plus the controller against a fake `SceneHost`. Database: migration runner tests without a
database; repository integration tests against Postgres in CI. Web: unit tests for the store and
timeline math; Playwright E2E for the plan's acceptance flow with fixture providers. See
`QA_PLAN.md`.

## What deliberately is not here

No microservices, no Redis (the `provider_cache` table is enough at this scale), no server GPU, no
custom map tiles, no MapLibre second renderer, no WorldView runtime dependency
(`WORLDVIEW_REUSE_AUDIT.md`).

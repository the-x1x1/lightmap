# QA Plan

The test pyramid as built for v0.1, plus the manual checks that automation does not cover. Plan
§32. Run everything locally with `pnpm test` (unit), `pnpm test:e2e` (Playwright), and the
database steps below.

## 1. Unit tests (Vitest, run on every PR)

Unit tests run under Node ≥ 22.12 with native type stripping; packages are consumed as source, so no
build step precedes them.

| Package / area            | File(s)                                                                  | What is asserted                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Astronomy golden set**  | `packages/astronomy/tests/golden.test.ts` + `fixtures/usno-golden.json`  | Against the US Naval Observatory for Hawaii, Arizona, London, Sydney, Tromsø, the equator, date-line cases, a DST boundary and polar night/midnight sun. Tolerances: **event times ±1 min** (±2 min above 66° latitude where the sun grazes the twilight threshold); **sun direction within 0.02°** as angular separation of unit vectors (azimuth alone is ill-conditioned near the zenith — Kailua is at 89.3°); **moon illuminated fraction within 3 %** and phase name agreement. |
| Astronomy service         | `service.test.ts`                                                        | The plan's acceptance case (Kailua, 31 May 2026, 12:30 HST → sun almost overhead, slightly north); golden and blue hour windows in order; lunar state with the honest accuracy note.                                                                                                                                                                                                                                                                                                  |
| Time zones                | `time.test.ts`                                                           | Local → UTC for zones without DST (Honolulu), spring-forward and fall-back days, date-line zones (±12/+14), invalid zone rejection, civil-day bounds.                                                                                                                                                                                                                                                                                                                                 |
| Weather normalisation     | `packages/weather/tests/providers.test.ts`                               | Open-Meteo JSON → `WeatherFrame`, missing/null fields, unit conversions, capability reporting with and without an API key; fixture provider determinism.                                                                                                                                                                                                                                                                                                                              |
| Horizon                   | `horizon.test.ts`                                                        | Every row of the decision table (HIGH ≤ 48 h, MEDIUM ≤ 7 d, LOW ≤ 16 d, SCENARIO beyond, RECENT_PAST ≤ 92 d, PAST older, no provider), `fetchWorthwhile`, cache key format.                                                                                                                                                                                                                                                                                                           |
| Scenarios                 | `scenarios.test.ts`                                                      | Scenario constants are frozen and monotone in cloud cover; `parametersForForecast` interpolates between anchors, low cloud lowers transmittance, visibility drives haze and fog, rain blends toward storm; colour-temperature curve and `kelvinToRgb` white point.                                                                                                                                                                                                                    |
| Entitlements              | `packages/entitlements/tests/entitlements.test.ts`                       | Plan → permissions; date window (14 ahead / 7 back); project and viewpoint limits; quality ceiling; status rules (active, trialing, past_due grace 7 days, canceled to period end, paused/unpaid/incomplete → free); `planForPrice` returns null for unknown prices.                                                                                                                                                                                                                  |
| Billing                   | `packages/billing/tests/webhook.test.ts`                                 | Idempotent replay → `duplicate`; each handled event type; `deleted` → canceled; unknown price → free; unmapped customer → audit + `unmapped`; refund is audit-only; period fields read from item when absent on the subscription; ignored types acknowledged.                                                                                                                                                                                                                         |
| Scene state               | `packages/scene/tests/scene.test.ts`                                     | `deriveConfidence` for every environment/weather combination; `deriveSourceMode` thresholds; camera helpers (FOV from focal length, heading normalisation, pitch clamp, `frameCoordinates`, `lightingGeometry`); scene assembly combines time, solar and weather correctly.                                                                                                                                                                                                           |
| Renderer sun-vector math  | `packages/renderer/tests/sun-vector.test.ts`                             | ENU → ECEF for the sun at known azimuth/elevation at several latitudes; `DirectionalLight.direction` is sun → ground; shadow-on-ground direction is opposite the sun's azimuth.                                                                                                                                                                                                                                                                                                       |
| Lighting mapping          | `lighting.test.ts`                                                       | `SceneState` → light colour/intensity, shadow darkness, fog density and grade uniforms per scenario; Clear vs Overcast differ by a large margin; night has no direct light.                                                                                                                                                                                                                                                                                                           |
| Quality governor          | `quality-governor.test.ts`                                               | FPS-driven ladder with hysteresis does not oscillate; rung monotonicity.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Capabilities              | `capabilities.test.ts`                                                   | WebGL2 probe results → Quality 0 vs 3D; low-power heuristic; context released.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Controller with fake host | `controller.test.ts`                                                     | The Cesium controller drives a plain-object `CesiumLike` host: applies light direction, shadows, fog, post-process uniforms, camera fly-to, pick → `GeoPoint`, and disposes cleanly.                                                                                                                                                                                                                                                                                                  |
| Camera math               | `camera-math.test.ts`                                                    | Altitude ↔ zoom, framing bounds (ported from WorldView, see the audit).                                                                                                                                                                                                                                                                                                                                                                                                               |
| Geospatial                | `packages/geospatial/tests/*.test.ts`                                    | Coordinate parsing formats, WGS84 helpers, grid-cell keys, provider registry rules (conditional/development-only never default).                                                                                                                                                                                                                                                                                                                                                      |
| Migration runner          | `packages/database/tests/migrate.test.ts`                                | Real migration files load in order and validate; apply once, skip on rerun, **refuse modified files by checksum**; disordered/duplicate/empty/destructive files are flagged; ULID shape and sortability.                                                                                                                                                                                                                                                                              |
| Env validation            | `packages/config/tests/env.test.ts`                                      | Production refuses `AUTH_DEV_LOGIN`, fixture providers and `sk_test_` Stripe keys; warns without `OPEN_METEO_API_KEY`; requires a real sign-in method; only `NEXT_PUBLIC_*` is public.                                                                                                                                                                                                                                                                                                |
| Observability             | `packages/observability/tests/observability.test.ts`                     | `redact` masks secret/PII keys; `quantizeForAnalytics` rounds to whole degrees; `sanitizeAnalyticsProps` strips forbidden props and long strings.                                                                                                                                                                                                                                                                                                                                     |
| Auth account service      | `packages/auth/tests/account.test.ts`                                    | Dev login only outside production; session helpers.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Reverse planning          | `packages/astronomy/tests/solver.test.ts`                                | Equinox sunrise due east; solstice-noon elevation 90 − φ + δ; Tromsø midnight sun at φ + δ − 90; sunset-azimuth round trip against `computeDayEvents`; ridge windows with both detectors (`via`); meridian-crossing invariant on near-zenith days (count(0°) + count(180°) = days); tropical multi-crossing order; moon illumination floor; maxDays truncation; a year of sun alignments < 2 s.                                                                                       |
| Climatology               | `packages/weather/tests/climatology.test.ts`                             | Daylight-window filtering in the local zone; shares sum to one; rain → storm class; wet-hour/wet-day fractions; `suggestedScenario`; zone-aware cache key per 0.5° cell; `buildMonthlyClimatology` fetches one month per year with bounded concurrency; fixture determinism; archive normalisation drops rows without cloud cover.                                                                                                                                                    |
| Hourly outlook            | `packages/weather/tests/outlook.test.ts`                                 | Empty on scenario days; one row per covered local hour with scenario class and direct-light share; uncovered hours absent; DST gap yields no duplicate row; `brightWindows` runs.                                                                                                                                                                                                                                                                                                     |
| Camera (frame inverse)    | `packages/scene/tests/scene.test.ts`                                     | `directionFromFrame` inverts `frameCoordinates` across headings/pitches/lenses; sensor presets: equivalent ↔ actual focal length round-trips and matches FOV.                                                                                                                                                                                                                                                                                                                         |
| Planning card             | `apps/web/tests/unit/planning-card.test.ts`                              | Card model carries source label, "Scenario (not a forecast)" vs "Forecast (provider)" wording, five confidence rows, attribution + timestamp, the Kailua acceptance facts, fixture note, file name.                                                                                                                                                                                                                                                                                   |
| Web unit                  | `apps/web/tests/unit/{store,timeline,use-scene,recurrence-text}.test.ts` | Planner store transitions (wall-clock preserved across zones, restore of saved viewpoint, force-scenario, finder picking forces the viewpoint camera and a new place clears the target, opening a panel opens the sheet); timeline minute/marker math; `useScene` composition with fake providers.                                                                                                                                                                                    |

Coverage is uploaded as a CI artifact. There is no coverage gate yet; the critical calculation paths
(astronomy, horizon, scenarios, entitlements, webhook) are expected to stay near 100 % line coverage.

## 2. Integration tests (main branch, PostGIS service)

CI's `integration` job starts `postgis/postgis:16-3.4`, runs `pnpm db:migrate` against it and then
the E2E suite with the fixture providers.

- **Migrations against Postgres**: the real migration set is applied to an empty database, then
  re-applied as a no-op. `0002_postgis_optional.sql` checks `pg_available_extensions` so the
  suite passes with and without PostGIS.
- **Repositories**: CI invokes `pnpm --filter @lightmap/database test:integration`
  (`packages/database/tests/integration/repositories.int.test.ts`), which applies the migrations
  and exercises `projectsRepo`, `viewpointsRepo`, `subscriptionsRepo`, `cacheRepo`, `usageRepo` and
  `retentionRepo` against the live database: owner scoping (a second user cannot read, update or
  delete), cascade on project and user erase, newest-snapshot-only, webhook idempotency, cache TTL,
  counter upsert, deletion-request due dates. Skipped automatically when `DATABASE_URL` is unset.
- Subscription → entitlement is covered by the webhook unit tests plus the E2E dev-sign-in flow
  reading `/api/account/entitlements`.

## 3. End-to-end tests (Playwright, `apps/web/tests/e2e/planner.spec.ts`)

Run against a built app with `WEATHER_PROVIDER=fixture`, `GEOCODER_PROVIDER=fixture`,
`AUTH_DEV_LOGIN=true`. Chromium desktop and a mobile profile.

1. **Kailua flow** (plan §32): open → search "Kailua" → pick the result → set 31 May 2026 →
   12:30 → assert `timeline-time` and `preview-time` read 12:30, `preview-sunrise` 05:48,
   `preview-sunset` 19:09, sun elevation ≈ 89°, a source badge is shown → switch Clear → Overcast
   → assert the grade/atmosphere readouts changed.
2. **Long-range date is a scenario**: choose a date beyond 16 days; the weather badge contains
   "scenario" / "unavailable this far ahead" and never a bare "Forecast" claim.
3. **Forecast comparison**: choose a date inside the horizon; the (fixture) forecast badge appears;
   pin a scenario; badge reads "Comparing scenario"; unpin returns to forecast.
4. **Camera rotation**: drag or key-rotate; the heading readout follows and wraps at 360°.
5. **Account flow**: dev sign-in → create project → save viewpoint → reload → open project →
   reopen viewpoint → location, time, camera and scenario are restored.
6. **Mobile sheet**: on the mobile profile the bottom sheet collapses and the map remains usable;
   collapsed, the glance line shows time · phase · sun · basis and opens the sheet when tapped;
   the timeline thumb is reachable.

Failures upload `playwright-report` as an artifact.

## 4. Manual accessibility checklist (before each release)

- [ ] Timeline: Tab to the thumb; ← / → move 1 min, PageUp/PageDown 1 h, Home = sunrise,
      End = sunset; the screen reader announces time and light phase (`aria-valuetext`).
- [ ] Every button and input has a name (VoiceOver rotor / NVDA element list shows no "button").
- [ ] Weather mode, scenario and source badges are understandable with colour removed (grayscale
      filter): text and icon carry the state.
- [ ] `prefers-reduced-motion: reduce`: no camera fly-to animation, no sky transition animation,
      timeline still updates instantly.
- [ ] Contrast: text on chrome and on the sun/twilight accents ≥ 4.5:1 (spot-check with a
      contrast tool).
- [ ] Mobile sheet and dialogs trap focus, close on Escape, and return focus to the trigger.
- [ ] Zoom to 200 %: no clipped controls, no horizontal page scroll.
- [ ] Touch targets on the timeline thumb and scenario buttons ≥ 44 px.

## 5. Release smoke checklist

Run against the deployed build after `release.yml` completes (or locally with `pnpm build && pnpm
start`).

- [ ] `GET /api/health` returns `ok: true`, `database: "ok"`, the expected `version`, and
      `fixtureMode: false`.
- [ ] Home loads under a strict CSP with no console CSP violations (check for `unsafe-eval` needs).
- [ ] Search a place, click the map, paste `21.397, -157.725`: pin moves each time; label resolves.
- [ ] Set a date inside 7 days: "Forecast" badge; set a date 6 months out: scenario wording.
- [ ] Scrub the timeline for 30 s: network panel shows **no** weather requests per tick; one request
      per place-day.
- [ ] Clear → Overcast → Storm visibly differ; shadows vanish in Overcast.
- [ ] Rotate camera in viewpoint mode; sun-in-frame indicator behaves.
- [ ] On a phone (real iPhone and Android, portrait): focusing the search box, a date field or
      the lens box does **not** zoom the page; the sheet's bottom padding clears the home
      indicator and the top bar clears the notch in the installed (standalone) app; swiping the
      handle up/down opens/closes the sheet; a tap on the collapsed glance line opens it; a tap
      in the viewpoint view (finder pick mode) places the ring even with a little finger wobble;
      the finder ring can be dragged with a finger.
- [ ] Light finder: "Centre of frame" with a westward camera at −0.8° finds sunsets on the right
      dates (compare one with the timeline); "Point in the view" places a ring where clicked and
      the ring follows a drag; jumping to a result moves the timeline; a Free account is clipped
      to its window with the paywall reason; the search does not freeze the timeline (worker).
- [ ] "This light" chip under the timeline: on a March afternoon it reads "Like this until
      <a day or two ahead> · Back <late September> (in ~186 days) <a time close to the current
              one>"; clicking "Back …" jumps date and time and the sun sits at the same place in the
      frame; at night the chip is absent; while scrubbing it dims and settles within a second;
      signed out / Free it reads "Beyond your date window · Pro" and opens the compact paywall.
- [ ] Export card (Pro): PNG downloads; it shows the source badge, the forecast/scenario line, the
      five confidence chips and attribution; text is not clipped for a long place name.
- [ ] Hour by hour (Pro) appears only when a forecast exists; bars match the timeline's scenario
      at a few hours; the table matches the bars; nothing appears for a date months out.
- [ ] Typical for this month (Pro): badge reads "Climatology · not a forecast"; shares sum to
      ~100 %; tapping a class changes the scenario and the badge says it is a comparison; Free sees
      the locked block; the same cell/month is served from cache the second time (`cached: true`).
- [ ] Shot variants: "+ Variant" appears only when the planner sits at a saved viewpoint's place;
      the variant lists under its parent; deleting the parent removes it.
- [ ] Sensor format (Pro): choosing APS-C and typing 16 shows ≈ 24.5 mm equivalent and widens the
      frame accordingly.
- [ ] Sign in with a magic link (production) or Google; sign out; session cookie is `Secure`.
- [ ] Create project, save viewpoint, reload, reopen.
- [ ] Free account hits the 14-day window and sees the paywall reason; Stripe Checkout opens;
      test/live webhook lands (`subscription_events` row) and the plan unlocks without reload.
- [ ] Customer Portal opens from the account panel.
- [ ] Attribution footer shows terrain, imagery and "Weather data by Open-Meteo.com".
- [ ] Development banner is **absent** in production.
- [ ] Error reporter receives a deliberate test event (trigger one from the dev performance panel
      in a staging build, or via the reporter's SDK CLI).

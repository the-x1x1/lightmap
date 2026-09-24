# LightMap

**A visual natural-light planner for photographers and filmmakers.** Pick any place on Earth, a
date and a time; LightMap computes the real sun and moon, applies a forecast or a clearly labelled
weather scenario, and shows how the light should behave — direction, shadows, warmth, twilight —
on real terrain. Scrub the day like a game timeline. Save the viewpoint to a shoot.

> "LightMap" is a working name. Rename in `packages/config/src/brand.ts`.

<!-- screenshots: docs/media/ (placeholder until the first deployed build) -->

| Map + timeline       | Golden hour, viewpoint mode | Overcast scenario    |
| -------------------- | --------------------------- | -------------------- |
| _screenshot pending_ | _screenshot pending_        | _screenshot pending_ |

## What it does (v0.1)

- World globe with real terrain; tap, search a place, paste coordinates or use device location.
- Date and continuous timeline with sunrise, golden hour, solar noon, sunset, blue hour and night
  marked; every tick recomputes sun position in well under a millisecond, client-side.
- Astronomy validated against the US Naval Observatory: sun direction within 0.02°, rise/set to the
  minute, correct on DST days, across the date line, and in polar day/night.
- Weather: hourly forecast inside the provider horizon (Open-Meteo, 16 days), labelled honestly by
  confidence; beyond it, five deterministic scenarios (Clear · Mostly Clear · Partly Cloudy ·
  Overcast · Rain/Storm) that are never called a forecast.
- Rendering: directional sunlight and terrain shadows from the computed sun vector, colour
  temperature by elevation, atmosphere and a weather grade so clear/partly/overcast look obviously
  different. A 2D sun/shadow overlay always works, even without WebGL2.
- Every preview carries a source label (Real Reference / Simulated Lighting / Estimated Preview)
  and a confidence breakdown (astronomy, terrain, scene detail, weather, real reference), plus a
  "why does it look like this?" explanation.
- Viewpoint camera: map orbit or eye-level first person; heading, pitch, full-frame lens presets.
- Accounts (passwordless email, optional Google), projects, saved viewpoints with thumbnails.
- Subscription plumbing in Stripe test mode with a central entitlement service (Free / Pro).
- No uploads, no social feed, no location-discovery engine. It is a planning instrument.

## Architecture in one paragraph

A pnpm/Turborepo TypeScript monorepo. `apps/web` is Next.js 15. Pure packages hold the product's
correctness: `astronomy` (Meeus/Almanac ephemeris), `weather` (normalised frames, horizon,
scenarios), `scene` (the single `SceneState` that combines location, time, camera, sun, moon,
atmosphere, environment, source and confidence), `entitlements`. `renderer` maps SceneState to a
CesiumJS scene through a narrow host interface. `geospatial`, `database`, `billing`, `auth`,
`observability` and `config` wrap the outside world behind interfaces. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Prerequisites

- Node.js ≥ 22.12 (`.nvmrc`), pnpm ≥ 10 (`corepack enable`).
- PostgreSQL ≥ 15 for accounts/projects/billing (PostGIS optional in development, required in
  production). Without a database the map, astronomy and forecasts still run.
- Optional: Stripe CLI for local webhooks; a Cesium ion token or an XYZ imagery key for
  higher-detail imagery.

## Local setup

```sh
pnpm install
cp .env.example .env            # edit as needed; defaults run in fixture/limited mode
pnpm env:validate               # explains what is configured
pnpm dev                        # http://localhost:3000 — map, astronomy and forecasts work without a database
```

Accounts, projects, saved viewpoints and billing need PostgreSQL. The quickest local option is
Docker (PostGIS image, matches the default `DATABASE_URL` in `.env.example`):

```sh
pnpm db:up                      # docker compose up -d db
pnpm db:migrate                 # applies packages/database/migrations/*.sql
pnpm db:seed                    # optional: dev user + six fixture viewpoints
```

Any other Postgres 15+ works: point `DATABASE_URL` in `.env` at it. The `db:*` scripts read `.env`
automatically (Node's `--env-file-if-exists`); `next dev` loads it too.

Sign in during development with **Dev sign-in** (any email; `AUTH_DEV_LOGIN=true`, refused in
production) or with a magic link printed to the server log when `EMAIL_SERVER` is empty.

### Environment variables

All keys are documented in [`.env.example`](.env.example) and validated by `packages/config/src/env.ts`.
The important ones:

| Key                                                                                                 | Purpose                                                                            |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                      | PostgreSQL. Unset ⇒ no accounts/projects/billing (exploration still works).        |
| `AUTH_SECRET`, `AUTH_URL`, `EMAIL_SERVER`, `EMAIL_FROM`, `AUTH_GOOGLE_*`, `AUTH_DEV_LOGIN`          | Auth.js.                                                                           |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` | Billing (test mode keys locally).                                                  |
| `WEATHER_PROVIDER` (`open-meteo` \| `fixture`), `OPEN_METEO_API_KEY`                                | Weather. Commercial use of Open-Meteo needs a paid key.                            |
| `GEOCODER_PROVIDER` (`nominatim` \| `fixture`), `GEOCODER_USER_AGENT`                               | Place search. Nominatim is development-only.                                       |
| `TERRAIN_PROVIDER` (`reearth` \| `cesium-ion` \| `ellipsoid`), `CESIUM_ION_TOKEN`                   | Terrain.                                                                           |
| `IMAGERY_PROVIDER` (`natural-earth` \| `cesium-ion` \| `xyz`), `IMAGERY_XYZ_*`                      | Basemap imagery; attribution is mandatory.                                         |
| `LIGHTMAP_SHOW_DEV_BANNER`                                                                          | Shows the "development mode" banner whenever a fixture/limited provider is active. |

## Commands

| Command                                                                                                                    | What                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm --filter @lightmap/web start`                                                            | Web app                                                       |
| `pnpm typecheck` · `pnpm lint` · `pnpm format:check`                                                                       | Quality gates                                                 |
| `pnpm test:unit`                                                                                                           | Vitest across packages and the web app                        |
| `pnpm --filter @lightmap/database test:integration`                                                                        | Repository tests against `DATABASE_URL`                       |
| `pnpm test:e2e`                                                                                                            | Playwright (fixture providers, dev sign-in; needs a database) |
| `pnpm db:migrate` · `pnpm db:seed` · `pnpm retention -- --dry-run`                                                         | Database                                                      |
| `pnpm licenses` (`--write-notices`) · `pnpm secrets:scan` · `node --experimental-strip-types scripts/check-attribution.ts` | Compliance gates                                              |
| `pnpm release <version>`                                                                                                   | Bump, changelog, tag                                          |

### Database migrations

Plain SQL in `packages/database/migrations/NNNN_name.sql`, applied in order by
`packages/database/src/migrate.ts` and recorded with a checksum in `schema_migrations`. Editing an
applied file is refused; write a new one. `0002_postgis_optional.sql` adds a PostGIS geography
column only when the extension is available. `drizzle-kit generate` can diff the TypeScript schema
against a database when authoring a migration.

### Stripe local webhooks

```sh
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# copy the printed whsec_… into STRIPE_WEBHOOK_SECRET, restart pnpm dev
stripe trigger customer.subscription.created
```

Events are processed idempotently (`subscription_events.provider_event_id` is unique); an unknown
price never grants Pro; a customer we cannot map is recorded for review.
[`docs/BILLING_AND_ENTITLEMENTS.md`](docs/BILLING_AND_ENTITLEMENTS.md).

### Providers

Every external source is behind an interface with licence, attribution and commercial-review
metadata; the client receives credential-free descriptors only. Read
[`docs/DATA_SOURCES_AND_LICENSING.md`](docs/DATA_SOURCES_AND_LICENSING.md) **before launch** — it
lists what is approved, what needs a contract (Open-Meteo commercial, a geocoder, imagery) and what
is blocked (real-reference imagery).

## Tests and CI

`.github/workflows/ci.yml` runs on every PR: install, env validation, format, lint, typecheck,
unit tests with coverage, attribution gate, licence gate, secrets scan, migration validity, build,
bundle budget. On `main` it also applies migrations to a PostGIS service and runs the repository
integration tests and Playwright E2E. `security.yml` adds `pnpm audit` and CodeQL weekly.
`release.yml` builds, migrates, deploys and smoke-tests on a `v*` tag.

## Documentation

|                                                                                                                                         |                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [NORTH_STAR](docs/NORTH_STAR.md)                                                                                                        | The thesis, what it is and is not, five-year direction |
| [PRODUCT_SPEC](docs/PRODUCT_SPEC.md)                                                                                                    | Canonical behaviour                                    |
| [ARCHITECTURE](docs/ARCHITECTURE.md)                                                                                                    | Packages, data flow pin → renderer, API                |
| [RENDERING_ACCURACY](docs/RENDERING_ACCURACY.md)                                                                                        | What each label can and cannot claim                   |
| [WEATHER_AND_FORECAST_MODEL](docs/WEATHER_AND_FORECAST_MODEL.md)                                                                        | Forecast vs scenario vs climatology                    |
| [DATA_SOURCES_AND_LICENSING](docs/DATA_SOURCES_AND_LICENSING.md)                                                                        | Every source, licence, cost, replacement               |
| [BILLING_AND_ENTITLEMENTS](docs/BILLING_AND_ENTITLEMENTS.md) · [PRIVACY](docs/PRIVACY.md) · [SECURITY_MODEL](docs/SECURITY_MODEL.md)    | Commercial and trust                                   |
| [ROADMAP](docs/ROADMAP.md) · [RELEASE_PROCESS](docs/RELEASE_PROCESS.md) · [QA_PLAN](docs/QA_PLAN.md) · [COST_MODEL](docs/COST_MODEL.md) | Operating the product                                  |
| [WORLDVIEW_REUSE_AUDIT](docs/WORLDVIEW_REUSE_AUDIT.md)                                                                                  | What was (and was not) reused from WorldView           |
| [ADR/](docs/ADR)                                                                                                                        | Architecture decisions                                 |

## Known limitations (v0.1)

- **Imagery is coarse by default.** Without an imagery key the globe shows Natural Earth II, so
  scenes are labelled _Estimated Preview_. Terrain relief and light direction are still real.
- **No buildings or vegetation.** Shadows come from terrain only.
- **Sky is a model, not a spectral simulation**; clouds are procedural coverage, not forecast shapes.
- **Moon accuracy is ±0.3°** (sun is ±0.01°); adequate for framing, not for eclipses.
- **Real-reference imagery is disabled** until a licensed provider contract exists.
- **Night sky**: Cesium's Moon mesh is hidden (it is lit by Cesium's own Sun and renders black at
  night); a moonlit atmosphere halo marks the Moon's position and lights the scene instead. Stars
  are faint under software GL.
- **Open-Meteo and Nominatim are development-tier** until commercial arrangements are made.
- **Legal pages are placeholders**; `docs/PRIVACY.md` is the engineering behaviour they will describe.
- Not yet run: Playwright E2E on a deployed environment (CI wiring is in place).

## Licence

Proprietary — see [LICENSE](LICENSE). Third-party components are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

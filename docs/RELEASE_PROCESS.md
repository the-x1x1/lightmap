# Release Process

Plan §35, §36. Files: `.github/workflows/{ci,security,release}.yml`, `scripts/release.ts`,
`packages/database/src/migrate.ts`.

## 1. Versioning

Semantic versioning (`MAJOR.MINOR.PATCH`, optional pre-release suffix). All workspace packages share
one version, bumped together. v0.x: minor bumps for new phases or user-visible features, patch bumps
for fixes. Breaking changes to saved-viewpoint data or the entitlement snapshot require a migration
and a minor bump at least.

## 2. Branch policy

`main` is always releasable. Work happens on branches merged by PR; a PR merges only when every gate
below is green. No direct pushes to `main`.

## 3. PR gate (`ci.yml` → `validate`)

In order, each must pass:

1. `pnpm install --frozen-lockfile`
2. `pnpm env:validate` (development rules; proves the validator itself runs)
3. `pnpm format:check` (Prettier)
4. `pnpm lint` (ESLint, zero warnings)
5. `pnpm typecheck` (TypeScript strict across the workspace)
6. `pnpm test:unit -- --coverage` (Vitest; coverage uploaded as an artifact)
7. `scripts/check-attribution.ts` — every registered data source has attribution text and a review
   state
8. `pnpm licenses:check` — every dependency licence is on `scripts/license-allowlist.json`; unknown or
   blocked → fail
9. `pnpm secrets:scan` — committed key patterns → fail
10. Migration validity — `validateMigrationSet(loadMigrations())` reports no disordered, duplicate,
    empty or destructive files
11. `pnpm build` (Next.js production build with telemetry disabled)
12. `scripts/check-bundle.ts` — first-load JS for `/` ≤ 150 KB gzipped (what `next build` reports as First Load JS) and the Cesium chunk is **not** in
    the first load

`security.yml` additionally runs `pnpm audit --audit-level high`, the secrets scan, the licence check
and CodeQL on every PR and weekly.

## 4. Main branch (`ci.yml` → `integration`)

After `validate` passes on `main`: start `postgis/postgis:16-3.4`, `pnpm db:migrate`, database
integration tests, install Chromium, `pnpm test:e2e` (Playwright) with fixture providers and dev
sign-in. Failures upload the Playwright report.

## 5. Cutting a release

```
git checkout main && git pull
pnpm release 0.2.0          # refuses on a dirty tree
git push --follow-tags
```

`scripts/release.ts`:

1. validates the semver argument and a clean working tree;
2. writes the version into the root and every `apps/*` and `packages/*` manifest;
3. prepends a `CHANGELOG.md` entry from commits since the last tag;
4. commits `release: vX.Y.Z` and creates annotated tag `vX.Y.Z`.

Pushing the tag triggers `release.yml` (GitHub environment `production`, which may require manual
approval):

1. install, `typecheck`, `test:unit`, `licenses`;
2. `pnpm build` with the production `NEXT_PUBLIC_APP_URL`;
3. **database migration**, forward-only, against `secrets.DATABASE_URL`;
4. **deploy** — a host-specific step deliberately not coupled to app code (plan §13). Wire one of
   `vercel deploy --prod`, `fly deploy` or a Render deploy hook here;
5. **smoke**: `pnpm smoke:prod $NEXT_PUBLIC_APP_URL` — health (`ok`, database, the tagged
   version, no fixture mode), the plan §29 security headers and a CSP without `unsafe-eval`,
   capabilities (no dev banner, no dev sign-in), manifest and an uncacheable service worker, the
   privacy page, and that `/api/account/profile` answers 401 and an unsigned Stripe event 400
   (`packages/observability/src/smoke.ts`, unit tested); with `--search` a live geocoder query
   and with `--weather` today's frames for Kailua from the live provider (a fail on the fixture
   or fewer than twelve frames, a warning when the frames carry no air temperature — a cache
   older than key v3); any `FAIL` stops the release, warnings (no billing, no database,
   bracketed legal placeholders) are printed;
6. the GitHub release is published by `desktop.yml`, not here: it builds the Windows installer
   from the same tag, smoke-tests it built and installed, attaches `LightMap-Setup-X.Y.Z.exe` and
   its `.sha256`, takes the notes from this version's `CHANGELOG.md` section, and only then marks
   the release latest. Installed desktop copies pick it up from there by themselves (§5b).

Order matters: migrate before deploy so the new code never meets an old schema; migrations must
therefore be backward compatible with the previous release for the minutes both may run.

Until a production host exists, steps 3 and 5 are skipped (the workflow checks whether the
`DATABASE_URL` secret and `NEXT_PUBLIC_APP_URL` variable are set on the `production` environment
and prints a notice instead); the GitHub release and its installer come from `desktop.yml` either way.
Set both in _Settings → Environments → production_ when the host is ready.

### 5a. Running a release on one machine (no database)

A production build on a laptop or desktop, for its owner only:

```powershell
git clone https://github.com/the-x1x1/lightmap.git lightmap-release; cd lightmap-release
git checkout "$(git describe --tags --abbrev=0)"
"LIGHTMAP_STANDALONE=true" | Set-Content .env
corepack pnpm@10.28.0 install --frozen-lockfile
corepack pnpm@10.28.0 build
corepack pnpm@10.28.0 --filter @lightmap/web start      # http://localhost:3000
```

`LIGHTMAP_STANDALONE=true` lifts the production requirement for a database, `AUTH_SECRET`,
`AUTH_URL` and a sign-in method: accounts, projects and billing are off, the map and planning work.
Without it a production server refuses every request (the strict pre-flight in §7 is the point of
production mode). The root `.env` is read by `next.config.ts`; never set the flag on a public host.

### 5b. The Windows app

LightMap ships to Windows as an installer with silent updates (`apps/desktop/README.md`). Every
push to `main` builds and smoke-tests it (`desktop.yml`) and keeps `LightMap-Setup-<version>.exe`
as a workflow artifact, so a broken desktop build shows before anything is tagged. A `v*` tag
publishes it. An installed copy checks the latest release at launch and every six hours, downloads
and verifies the installer in the background, and installs it silently when the app closes.

To roll the desktop app back, publish a new, higher version: installed copies only ever move
forward, and deleting a release only stops copies that have not staged it yet.

## 6. Rollback

**Application**: redeploy the previous tag on the host (`vercel rollback`, `fly deploy --image
<previous>`, or the host's release history). No code path in LightMap depends on the deployment
platform, so this is safe at any time.

**Database**: there is no "down" migration. Rollback is a **new forward migration that reverses the
change** (e.g. re-add a dropped column with a backfill). The runner records a SHA-256 checksum per
applied file and **refuses to apply a migration whose file has been edited after it was recorded**,
so history cannot be rewritten silently; write a new numbered file instead. Because migrations must
be compatible with the previous app version (§5), an app rollback never requires a schema rollback
in the common case.

**Billing**: entitlements are derived from stored subscription rows, so a bad deploy cannot grant
access. If a webhook backlog built up, Stripe redelivers; idempotency makes redelivery safe.

## 7. Production pre-flight (before the first live release and after infra changes)

- [ ] **PostGIS present** on the target database (`0002_postgis_optional.sql` enables it when
      available; PostGIS is expected in production).
- [ ] `pnpm env:validate` with `NODE_ENV=production` passes with **no errors**: `DATABASE_URL`,
      `AUTH_SECRET`, `AUTH_URL`, a real sign-in method, `AUTH_DEV_LOGIN` off, no fixture providers.
- [ ] **Stripe live keys**: `sk_live_…`, live webhook secret registered on the production URL, live
      price ids in `STRIPE_PRICE_PRO_MONTHLY/YEARLY`. A test key fails validation.
- [ ] **Weather commercial plan**: `OPEN_METEO_API_KEY` set (validation warns otherwise) and the
      subscription tier sized to the budgets in `COST_MODEL.md`.
- [ ] **Geocoder contract**: `GEOCODER_PROVIDER` is a commercial provider; Nominatim is
      development-only and refused when marked so.
- [ ] Terrain/imagery provider review states are `approved` in the registry; attribution footer
      verified.
- [ ] `SENTRY_DSN` (or equivalent) set; `/api/health` monitored.
- [ ] `ANALYTICS_SINK` decided (`none` unless the privacy page's analytics wording is wanted
      live; `log` records only the sanitised event set, `PRIVACY.md` §4).
- [ ] Managed database backups and point-in-time recovery enabled and tested once.
- [ ] Retention job: `retention.yml` sees the production `DATABASE_URL`; run it once manually with the dry-run switch and read the log
      (`PRIVACY.md` §8).
- [ ] Legal pages (privacy, terms) contain real text, not placeholders.

## 8. Feature flags

Unfinished or unlicensed features ship dark, never as half-built navigation (plan §35):

- `REFERENCE_IMAGERY_PROVIDER=none` hides every Real Reference surface.
- Studio plan has no price and is never offered.
- Features behind an entitlement (climatology, reverse planning, export, the week ahead) show
  their name and reason when locked, never a half-built flow; the
  entitlement keys exist so plans can advertise them, but no control is rendered for a missing
  feature.
- `LIGHTMAP_SHOW_DEV_BANNER` and the performance panel are development-only and flagged as warnings
  in production.

New flags go in `packages/config/src/env.ts` so validation knows about them.

## 9. Hotfixes

Branch from the release tag, fix, PR to `main` (full gate), then `pnpm release X.Y.Z+1` from `main`.
Do not tag from a branch.

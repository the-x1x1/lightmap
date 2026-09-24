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
8. `pnpm licenses` — every dependency licence is on `scripts/license-allowlist.json`; unknown or
   blocked → fail
9. `pnpm secrets:scan` — committed key patterns → fail
10. Migration validity — `validateMigrationSet(loadMigrations())` reports no disordered, duplicate,
    empty or destructive files
11. `pnpm build` (Next.js production build with telemetry disabled)
12. `scripts/check-bundle.ts` — first-load JS for `/` ≤ 350 KB and the Cesium chunk is **not** in
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
5. **smoke**: `GET /api/health` must return `ok: true`;
6. GitHub release with generated notes.

Order matters: migrate before deploy so the new code never meets an old schema; migrations must
therefore be backward compatible with the previous release for the minutes both may run.

Until a production host exists, steps 3 and 5 are skipped (the workflow checks whether the
`DATABASE_URL` secret and `NEXT_PUBLIC_APP_URL` variable are set on the `production` environment
and prints a notice instead), so tagging still produces a GitHub release from a fully gated build.
Set both in _Settings → Environments → production_ when the host is ready.

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
- [ ] Managed database backups and point-in-time recovery enabled and tested once.
- [ ] Retention job (`pnpm retention`) scheduled daily; verified once with `--dry-run`
      (`PRIVACY.md` §8).
- [ ] Legal pages (privacy, terms) contain real text, not placeholders.

## 8. Feature flags

Unfinished or unlicensed features ship dark, never as half-built navigation (plan §35):

- `REFERENCE_IMAGERY_PROVIDER=none` hides every Real Reference surface.
- Studio plan has no price and is never offered.
- Climatology, reverse planning and export are absent from the UI until their phase ships; the
  entitlement keys exist so plans can advertise them, but no control is rendered for a missing
  feature.
- `LIGHTMAP_SHOW_DEV_BANNER` and the performance panel are development-only and flagged as warnings
  in production.

New flags go in `packages/config/src/env.ts` so validation knows about them.

## 9. Hotfixes

Branch from the release tag, fix, PR to `main` (full gate), then `pnpm release X.Y.Z+1` from `main`.
Do not tag from a branch.

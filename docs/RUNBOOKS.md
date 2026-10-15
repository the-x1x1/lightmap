# Runbooks

Operating procedures for the situations the plan's pre-flight (§43) says must be written down
before commercial beta. Each runbook: how you notice, what the user sees, what to do, how to
verify, what to write down. Keep them boring and exact.

Where things are: logs are structured JSON from `createLogger` (`packages/observability`);
errors go to the DSN in `SENTRY_DSN` (envelope transport, `sentry-envelope.ts`) and to the logs;
health is `GET /api/health` (`ok`, `version`, `database`, `fixtureMode`); usage is
`pnpm usage:report`; migrations are `pnpm db:migrate`; retention is `retention.yml`; product
analytics (`PRIVACY.md` §4) are `analytics <event>` lines in the same log when
`ANALYTICS_SINK=log` (off in production unless set — the client sends nothing then).

## R0. Deploying the hosted service (accounts, saved projects, Pro)

The web app with a database is what accounts live on; the Windows and Mac apps sign in to it
(SECURITY_MODEL.md "Desktop sign-in"). It needs four things: a host for the app, PostgreSQL, a
mail sender for sign-in links, and Stripe for Pro.

1. **Database**: a managed PostgreSQL 16 (Neon, Supabase, Fly Postgres, RDS). Take its
   connection string as `DATABASE_URL` (with `?sslmode=require` where the provider asks).
2. **App**, either:
   - **A container** (Fly.io, Render, Railway, a VPS): `deploy/Dockerfile`. On Fly, copy
     `deploy/fly.toml.example` to `fly.toml`; its `release_command` applies the migrations
     before each release takes traffic. Elsewhere, run
     `node --experimental-strip-types db/src/migrate-cli.ts` in the image once per release.
   - **Vercel**: import the repository with `apps/web` as the root (framework Next.js), and run
     `pnpm db:migrate` with the production `DATABASE_URL` from a checkout before each release.
3. **Settings** (production; `.env.example` documents each): `DATABASE_URL`, `AUTH_SECRET` (`openssl
rand -base64 32`), `AUTH_URL` and `NEXT_PUBLIC_APP_URL` (the public https origin),
   `EMAIL_SERVER` and `EMAIL_FROM` (for Resend: `smtp://resend:<API key>@smtp.resend.com:465` and
   a sender on a verified domain), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, and `OPEN_METEO_API_KEY` for commercial
   use. The server refuses to start in production without a database, an auth secret and a real
   sign-in method.
4. **Stripe**: create the Pro product with a monthly and a yearly price, and a webhook endpoint at
   `https://<origin>/api/webhooks/stripe` for the subscription events (R2 lists them). Test mode
   first: a test card through checkout should turn the account to Pro within seconds.
5. **Desktop apps**: set `App.AccountOrigin` (`apps/desktop/LightMap.Desktop/App.cs`) and
   `Paths.accountOrigin` (`apps/desktop/mac/Sources/Paths.swift`) to the origin, and release;
   installed copies update themselves and offer "Sign in with your browser".
6. **Retention**: schedule `scripts/retention.ts` daily (`retention.yml`) against the database.

**Verify**: `GET /api/health` answers `database: ok`; an email sign-in link arrives; a fourth
project on a Free account is refused; a desktop app signs in through `/link` and lists the
account's projects.

## R1. Weather provider outage or quota exhaustion

**Notice**: `weather provider failed` warnings in logs; `/api/weather` answering 502
`weather_unavailable`; Open-Meteo status page; a spike in `climatology_unavailable`.

**Users see**: "Live forecast unavailable — showing your selected scenario." The map, astronomy,
scenarios and saved viewpoints keep working (plan §34). Nothing is mislabelled: the badge reads
Scenario.

**Do**:

1. Confirm it is the provider, not us: `curl "https://api.open-meteo.com/v1/forecast?latitude=21.4&longitude=-157.7&hourly=cloud_cover"`.
2. If the free tier is rate-limited (HTTP 429): the commercial key is the fix, not a retry loop —
   set `OPEN_METEO_API_KEY` (customer endpoint) and redeploy. Cached place-days keep serving for
   their TTL (60 min forecast, 6 h recent past, 30 d climatology).
3. If Open-Meteo is down: nothing to do server-side; do not raise budgets. Post a status note if
   it lasts > 1 h.
4. If our budgets are the cause (`budget_exhausted` 429s from us): read `pnpm usage:report`; a
   busiest-key share above ~30 % means one client — check for abuse before raising
   `DAILY_BUDGET_LIMITS`.

**Verify**: `/api/weather` for a date inside 7 days returns `mode: FORECAST`; the badge says
Forecast again.

**Write down**: start/end, provider status, whether cache TTLs masked it.

## R2. Stripe webhook failures

**Notice**: Stripe Dashboard → Developers → Webhooks shows failed deliveries; `/api/webhooks/stripe`
returning 400 (bad signature) or 500; `subscription_events` rows with `outcome: 'error'` or
`'unmapped'`.

**Users see**: a paid subscription that does not unlock (plan stays Free), or a cancelled one that
keeps Pro until the next successful event.

**Do**:

1. 400 `invalid_signature`: `STRIPE_WEBHOOK_SECRET` does not match the endpoint (common after
   re-creating the endpoint or switching test/live). Copy the endpoint's signing secret, redeploy.
2. `unmapped` outcomes: the Stripe customer has no `stripe_customer_id` mapping and no
   `metadata.userId`. Find the user by email in Stripe, run the mapping (`databaseBillingStore(db).linkCustomer(userId, customerId)` from
   `packages/billing/src/store.ts` in a one-off script), then **replay** the event from the
   Stripe Dashboard ("Resend"). Replays are idempotent (`provider_event_id` unique).
3. 500s: read the error report (DSN) for `eventId`; fix; resend the failed events from Stripe in
   order (oldest first).
4. Never hand-edit `subscriptions`: resend the event so the audit trail stays true.

**Verify**: `GET /api/account/entitlements` for the affected user shows the expected plan; Stripe
shows the delivery as succeeded.

**Write down**: event ids replayed, root cause, whether any user was over- or under-entitled and
for how long.

## R3. Database unavailable or degraded

**Notice**: `/api/health` returns 503 with `database: "error"`; API routes answering 500;
connection errors in logs.

**Users see**: exploration still works (map, astronomy, scenarios: no database needed); saving,
sign-in and billing fail with a clear message.

**Do**:

1. Check the host's database status; connection count (`max` in `createDb` is small per instance —
   many instances can exhaust a small plan's connection limit; use a pooler).
2. If the host restored from backup: run `pnpm db:migrate` (idempotent; refuses modified files),
   then `GET /api/health`.
3. If migrations fail on an old snapshot: never edit an applied migration; write a new one.

**Verify**: health `ok: true`; a project can be created and reopened.

## R4. Restore from backup

Backups are the host's (plan: daily snapshots, 30-day retention; verify the setting on the host
before beta — this file cannot check it for you).

1. Announce a write freeze (disable the deploy, or set the app read-only at the load balancer).
2. Restore the snapshot to a **new** database; point a staging deployment at it; run
   `pnpm db:migrate`; check `/api/health` and open a known project.
3. Switch `DATABASE_URL` in production to the restored database; redeploy; lift the freeze.
4. Stripe is the source of truth for subscriptions: after a restore older than the last webhook,
   resend the last day's events from the Stripe Dashboard (R2 step 3) to re-derive plans.
5. Users whose deletion requests were lost will be re-erased by the retention job once they
   re-request; those already erased stay erased (audit rows are PII-free and survive).

## R5. Bad release

**Notice**: `release.yml` smoke step fails, error rate rises after a deploy, or CSP violations
appear in the browser console.

**Do**: roll the deployment back to the previous build (host-specific). Migrations are
forward-only and backward compatible with the previous release for the overlap window
(`RELEASE_PROCESS.md` §6), so a code rollback needs no database action. Do not roll back
migrations. Fix forward with a patch release.

## R6. Suspected abuse or scraping

**Notice**: burst limits tripping (`rate_limited` 429s), a single key dominating
`pnpm usage:report`, geocoder budget exhaustion.

**Do**: budgets already cap cost per key per day; anonymous keys are hashed client fingerprints
and can be blocked at the edge. Do not lower budgets for everyone to stop one client. If the
geocoder policy (Nominatim usage policy in development) is at risk, switch `GEOCODER_PROVIDER`
to the contracted provider.

## R7. Data-subject request (access / deletion)

**Deletion**: the user can self-serve (`POST /api/account/delete`, 14-day window, `PRIVACY.md`
§8). On a written request: trigger the same path or set `deletion_requested_at` directly; the
retention job erases after 14 days; reply with the date.

**Access**: export the user's rows (`users`, `profiles`, `projects`, `viewpoints`,
`preview_snapshots`, `subscriptions`) with a one-off query; do not include other users' data or
audit rows of other users. Stripe holds invoices separately — point the user to the Customer
Portal.

## R8a. A tile host is down or refusing (terrain, imagery, buildings, land cover)

**Notice**: the globe shows flat ground or the bare basemap; buildings vanish; the painted
ground stops following the map (fields and forest no longer where the map has them); console
CSP or CORS violations.

**Do**: terrain and imagery fall back on their own (flat ground, Natural Earth) and the status
line says so; land cover fails silently to the procedural surface. Check the host, then that
its origin is in the CSP (`LANDCOVER_XYZ_URL` / `IMAGERY_XYZ_URL` are read at startup — a URL
changed without a restart is not allowlisted) and that it sends CORS headers for image reads.
Switch the provider env to the alternative or `none` and redeploy if the host stays down.

## R8. Provider licence or attribution problem

**Notice**: a provider changes terms; the attribution gate (`scripts/check-attribution.ts`)
fails in CI; a takedown notice.

**Do**: providers are swappable behind interfaces (`DATA_SOURCES_AND_LICENSING.md` "replacement"
column). Switch the env to the alternative or the fixture (development only), redeploy, update the
docs row. Never ship without the attribution footer; never re-enable a blocked source.

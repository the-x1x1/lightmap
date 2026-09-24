# Security Model

Threats LightMap defends against, the controls in place, and where they live. Plan §29. Report
vulnerabilities as described in `/SECURITY.md`.

## 1. Assets and threat model

| Asset                                                     | Threat                                                            | Primary controls                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Provider credentials (weather, terrain, geocoder, Stripe) | Exfiltration from the browser bundle; abuse via our proxy         | Server-side only; rate limits and daily budgets; CSP `connect-src` allowlist                     |
| User accounts and sessions                                | Credential theft, session fixation, CSRF                          | Passwordless magic links, database sessions, secure cookies, Auth.js CSRF                        |
| Projects and viewpoints (user location data)              | Horizontal privilege escalation by ID guessing or tampering       | `WHERE user_id = ?` in every repository query; IDs are never authorization                       |
| Entitlements                                              | Forged webhooks, replayed events, client-asserted plan            | Stripe signature verification, idempotency by event id, server-only snapshot                     |
| Database                                                  | Injection, schema drift, silent migration edits                   | Drizzle parameterised queries, checksum-verified forward-only migrations                         |
| Supply chain                                              | Malicious or licence-incompatible dependencies, committed secrets | `pnpm audit`, licence allowlist, secrets scan, CodeQL in CI                                      |
| Availability and cost                                     | Scraping our provider proxies, timeline scrubbing storms          | Burst limiter, per-day budgets, client-side astronomy, one weather fetch per place-day           |
| Browser                                                   | XSS, clickjacking, framing, mixed content                         | Strict CSP, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, HSTS, `upgrade-insecure-requests` |

Out of scope for v0.1: DDoS mitigation beyond the hosting platform, WAF, SOC-style monitoring.

## 2. Credentials stay server-side

Only `NEXT_PUBLIC_*` variables reach the client (`packages/config/src/env.ts`). Weather, geocoding
and reverse geocoding go through `/api/*` routes that attach credentials on the server. The only
browser-side provider traffic is tile fetching from terrain/imagery CDNs, which is allowlisted in
the CSP and either credential-free (Re:Earth, Natural Earth) or uses a token designed for browser
use (Cesium ion, when configured).

## 3. Content Security Policy and headers

Defined in `apps/web/next.config.ts` and sent on every response.

```
default-src 'self'
script-src 'self' 'wasm-unsafe-eval' blob:          (+ 'unsafe-eval' 'unsafe-inline' in development only)
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob: <terrain/imagery/weather hosts>
connect-src 'self' blob: data: <terrain/imagery/weather hosts> https://api.stripe.com
worker-src 'self' blob:
child-src 'self' blob:
font-src 'self' data:
frame-src https://js.stripe.com https://checkout.stripe.com
frame-ancestors 'none'
base-uri 'self'
form-action 'self' https://checkout.stripe.com https://billing.stripe.com
upgrade-insecure-requests
```

`'wasm-unsafe-eval'` and `blob:` are required by Cesium's Web Workers and Draco/KTX decoders.
**`'unsafe-eval'` is not needed in production** because LightMap imports `@cesium/engine`
directly; the `cesium` meta-package would pull in `@cesium/widgets` and Knockout, whose
module-scope `eval` breaks a strict CSP (ADR-0002, finding from the WorldView audit).

Other headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(self "https://checkout.stripe.com")`,
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
`Cross-Origin-Opener-Policy: same-origin`. `X-Powered-By` is disabled.

## 4. Authentication and sessions

- **Auth.js** with the Drizzle adapter; **database sessions** (`sessions` table) for email and
  Google sign-in, so a session can be revoked server-side.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production (`useSecureCookies: isProd`).
- Session lifetime and rolling refresh are configured centrally (`SESSION_MAX_AGE_SECONDS`,
  `SESSION_UPDATE_AGE_SECONDS`).
- **CSRF**: Auth.js's double-submit CSRF token protects sign-in/out. Mutating API routes are
  same-origin JSON requests that require the session cookie; `SameSite=Lax` plus
  `form-action 'self'` prevents cross-site form posts.
- **Dev sign-in** (`AUTH_DEV_LOGIN`): a credentials provider that only exists when the flag is on.
  Auth.js requires JWT sessions for credentials providers, so this mode uses JWT. Environment
  validation marks `AUTH_DEV_LOGIN` as an **error in production**; the server refuses to start.
- Production must configure at least one real sign-in method (`EMAIL_SERVER` or Google), enforced
  by env validation.

## 5. Billing integrity

- Every webhook body is verified with the Stripe SDK against `STRIPE_WEBHOOK_SECRET` before it is
  parsed; failures return 400.
- Idempotency: `(provider, provider_event_id)` is unique in `subscription_events`; a replay is a
  no-op returning `duplicate`.
- Unknown price ids map to `free`, never Pro. Customers that cannot be mapped to a user are audited
  and not written.
- A test-mode `sk_test_` key in production fails env validation.
- The client never sends a plan. It receives the derived snapshot from
  `GET /api/account/entitlements` and every server-side check recomputes it from the database.

## 6. Authorization

A user must never reach another user's project by changing an ID. Enforcement is in the data layer,
not the route layer:

- Every query in `packages/database/src/repositories.ts` that reads or mutates `projects`,
  `viewpoints` or `preview_snapshots` includes `eq(<table>.userId, userId)` (or joins through an
  ownership check on the parent project). A route cannot forget to filter because the repository
  signature requires the user id.
- Identifiers are **ULIDs**: unguessable in practice, but treated purely as identifiers. Knowing an
  ID grants nothing.
- Entitlement limits (project and viewpoint counts, date window, quality) are re-checked
  server-side on every write.

## 7. Database

- **Drizzle ORM** generates parameterised queries; raw SQL fragments use `sql` tagged templates
  with bound parameters. No string-concatenated SQL.
- Migrations are plain SQL files applied by `packages/database/src/migrate.ts` inside a
  transaction, recorded with a SHA-256 checksum. The runner **refuses to run** if an applied
  migration's file has changed (`Migration … was modified after being applied`). Rollback is a new
  forward migration (see `RELEASE_PROCESS.md`).
- Foreign keys cascade on user deletion so no orphaned personal data survives erasure.
- `DATABASE_URL` is required in production; the app runs without a database only in development.

## 8. Rate limiting and budgets

Two layers in `apps/web/lib/server/rate-limit.ts`:

1. **Burst**: process-local sliding window per client key (e.g. 30 weather requests per minute).
   Returns 429 `rate_limited`.
2. **Daily budgets** per resource in `usage_counters`, from `DAILY_BUDGET_LIMITS`
   (`packages/observability`): weather 40/150/600, geocoder 30/100/400, terrain bytes
   300 MB/1 GB/5 GB, preview 200/1,000/5,000 for anonymous/free/pro. Returns 429
   `budget_exhausted`. Cache hits are not charged.

Client keys are `u:<userId>` for signed-in users or a salted SHA-256 of IP + User-Agent for
anonymous traffic; raw IPs are never stored.

## 9. Input validation

Every API route parses its inputs through the helpers in `apps/web/lib/server/http.ts` (`num` with
range, `str` with length and pattern, IANA time-zone validation, civil-date validation) and throws
`HttpError(400, 'bad_request', …)` on failure. Bodies for project and viewpoint writes are validated
field-by-field (lengths, numeric ranges, enum membership for weather mode/scenario/source type)
before they reach the repository. Unknown fields are ignored, not stored.

## 10. Supply chain and CI

- `pnpm audit --audit-level high` fails the build on high/critical advisories (weekly and on every
  PR via `security.yml`).
- `scripts/check-licenses.ts` enforces `scripts/license-allowlist.json`; unknown or blocked licences
  (GPL/AGPL without an approved exception) fail CI.
- `scripts/scan-secrets.ts` fails on committed key patterns (Stripe, AWS, private keys, generic
  tokens).
- CodeQL (javascript-typescript) runs on PRs and main.
- Lockfile is frozen in CI (`pnpm install --frozen-lockfile`).

## 11. Account deletion

Request → 14-day window → hard delete cascade; audit rows kept without PII. Details and current
gaps in `PRIVACY.md` §8.

## 12. Incident response basics

1. **Detect**: error reporter (`SENTRY_DSN`), structured logs, `/api/health`, Stripe webhook
   failure alerts in the Stripe Dashboard.
2. **Contain**: rotate the affected secret (`AUTH_SECRET` invalidates all sessions; Stripe keys and
   webhook secret from the Dashboard; provider keys from their consoles) and redeploy. Feature flags
   can disable billing or a provider without a code change.
3. **Assess**: audit_events and subscription_events give a timeline without PII; database access
   logs come from the managed Postgres provider.
4. **Recover**: redeploy the previous tag (app) or apply a corrective forward migration (schema);
   restore from the managed database's point-in-time backup if data was damaged.
5. **Notify**: if personal data (email, saved locations) was exposed, notify affected users and, where
   required, regulators within the legal window. Record the incident and the follow-up actions in
   the repository's `SECURITY.md` history.

Owner runbooks for the production host, database provider and Stripe account are a commercial-beta
deliverable (plan §43), not part of v0.1.

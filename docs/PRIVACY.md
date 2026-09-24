# Privacy — Engineering Behaviour

This document describes what the code actually does with personal data. It is the engineering
counterpart of the user-facing privacy policy (a legal placeholder until launch) and must be updated
whenever the behaviour changes. Plan §30, §31.

LightMap handles location searches. Location history is sensitive. The default is to keep it on the
device.

## 1. Anonymous exploration stays local

- Choosing a place, date, time, scenario and camera lives in the client planner store
  (`apps/web/features/planner/store.ts`). Nothing in that store is sent to a server until the user
  explicitly saves a viewpoint.
- Astronomy runs entirely in the browser. No coordinate is needed server-side to compute sun or
  moon positions.
- Two server calls exist during anonymous exploration, both stateless with respect to identity:
  weather (grid-cell coordinates, see §5) and geocoding (the typed query). Neither is joined to an
  account, session or device identifier in storage.

## 2. Coordinates are stored only on explicit save

- A viewpoint's latitude, longitude, elevation, time zone, camera and chosen instant are written to
  `viewpoints` only when a signed-in user presses save.
- Projects store the user's name, notes and shoot date. Notes are freeform and never leave the
  database except to the owning user.
- Preview thumbnails, when generated, are derived from the render (terrain and map data), never from
  any user photo — no user imagery exists in the product.

## 3. Device geolocation is opt-in

`navigator.geolocation.getCurrentPosition` is called only when the user presses the "use my
location" control. It is never requested on page load, and the resulting coordinate is treated like
any other selection: local until saved. The `Permissions-Policy` header restricts geolocation to
the app's own origin.

## 4. Analytics

`packages/observability` is the only analytics path, and it is privacy-conscious by construction:

- Coordinates may only appear quantised to **whole degrees** (`quantizeForAnalytics`: ≈ 110 km
  buckets).
- `sanitizeAnalyticsProps` strips any property named `lat`, `latitude`, `lng`, `lon`,
  `longitude`, `notes`, `description`, `email`, `name`, `label` or `query`, and any string longer
  than 64 characters, regardless of what the caller passed.
- Events are limited to the product set: `location_selected`, `timeline_scrubbed`,
  `weather_scenario_changed`, `project_created`, `viewpoint_saved`, `preview_expanded`,
  `upgrade_started`, `subscription_started`.
- The default sink is a logger or a no-op; a third-party analytics vendor would plug in behind
  `AnalyticsSink` and would still only receive sanitised properties.

## 5. Server logs

Structured JSON logs go through `redact()`, which replaces the value of any key matching
`token | secret | password | authorization | cookie | apikey | api_key | email` with
`[redacted]`, recursively, and reduces `Error` objects to name and message. Request logs record
route, status, latency and the hashed client key — not raw IPs, not query strings containing
coordinates.

## 6. Server caches hold no identity

| Cache | Key | Contents |
|---|---|---|
| Weather | provider, version, **0.05° grid cell**, civil day | Hourly frames for the cell |
| Geocode (forward) | normalised query string | Place candidates |
| Reverse geocode | **0.01° grid cell** | Place label |

All three live in `provider_cache` with an expiry and no user, session or device column. A cached
entry cannot be tied back to who requested it.

## 7. Rate-limit keys

Anonymous rate-limit and budget keys are `sha256(AUTH_SECRET | ip | user-agent)` truncated to 24
hex characters (`clientKey()` in `apps/web/lib/server/rate-limit.ts`). Raw IPs are never stored in
`usage_counters` or logs. Signed-in users are keyed by user id.

## 8. Account deletion

1. **Request**: `POST /api/account/delete` sets `users.deletion_requested_at` and writes an audit
   row `account.deletion_requested`. Sign-in remains possible.
2. **14-day window**: signing in again during the window cancels the request (the Auth.js `signIn`
   event clears `deletion_requested_at`, `packages/auth/src/authjs-config.ts`), so accidental
   deletions are reversible.
3. **Hard delete**: the retention job (`pnpm retention`, `scripts/retention.ts`, run daily) erases
   accounts whose request is older than 14 days with `usersRepo.erase()`, a `DELETE FROM users`
   that cascades to `accounts`, `sessions`, `profiles`, `projects`, `viewpoints`,
   `preview_snapshots` and `subscriptions`, and purges expired `provider_cache` rows. `--dry-run`
   lists what would be erased.
4. **Audit rows are kept without PII**: `audit_events.user_id` is a bare ULID with no foreign key,
   and audit metadata never contains email, names, notes or coordinates.
5. Stripe retains its own customer and invoice records under its terms; the operator should cancel
   the subscription in Stripe as part of deletion (Customer Portal or Dashboard).

The scheduled job that calls `erase()` for accounts past the window is a production-configuration
item (see `RELEASE_PROCESS.md` pre-flight); the repository method and cascade rules exist and are
tested.

## 9. Data retention

| Data | Retention | Notes |
|---|---|---|
| Planner state (anonymous) | Browser only; cleared on reload unless saved | Never on the server |
| Projects, viewpoints, thumbnails | Until deleted by the user or account erasure | |
| Sessions | Auth.js session expiry; deleted on logout and account erasure | |
| Verification tokens (magic links) | Until used or expired (Auth.js default) | |
| Subscriptions | Life of the account; erased with it | |
| Subscription events (webhook payloads) | Kept for idempotency and dispute resolution; `user_id` nulled by erasure is **not** automatic — payloads contain Stripe ids, not names or coordinates | Review before launch |
| Audit events | Kept indefinitely without PII | |
| Provider cache | TTL: 60 min forecast, 6 h recent past, geocode per provider `cache.maxAgeSeconds` | Purged by `purgeExpired()` |
| Usage counters | Per UTC day; older rows may be deleted after 90 days | Hashed keys only |
| Server logs | Per hosting platform retention; redacted at write time | |

## 10. What is sent to third parties

| Recipient | What | What is not sent |
|---|---|---|
| Weather provider (Open-Meteo) | Coordinates **rounded to the 0.05° grid cell**, date range, requested fields; from the server, not the browser | User id, session, IP of the user (the server's IP is used), exact pin |
| Geocoder (Nominatim in development; a commercial geocoder in production) | The search query string; reverse lookups use the 0.01° cell | Any identity |
| Terrain and basemap tile hosts | Tile requests from the browser (standard for any web map); the browser's IP is visible to the CDN | No coordinates beyond the tiles being viewed |
| Stripe | Email address, user id as `client_reference_id`, payment details entered on Stripe's hosted pages | Locations, projects, notes |
| Email provider (magic links) | Email address, sign-in link | Anything else |
| Error monitoring (when `SENTRY_DSN` is set) | Error messages and stack traces, redacted context | Coordinates, freeform text |

**No imagery uploads exist.** There is no path by which a user photo reaches LightMap or any third
party.

## 11. Cookies

Auth.js session and CSRF cookies only, `HttpOnly`, `SameSite=Lax`, `Secure` in production. No
advertising or cross-site tracking cookies. Per-viewer conveniences (collapsed sheet, last tab) may
use `localStorage`; they never contain coordinates.

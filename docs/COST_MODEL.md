# Cost Model

Anticipated **marginal** infrastructure cost per month at 100 / 1,000 / 10,000 / 100,000 monthly
active users (MAU). Plan §19, §39.

**Every number here is an estimate to be replaced with measured figures.** The measurement
instruments already exist: `usage_counters` (per-resource, per-day request counts by plan),
`provider_cache` hit/miss (`cached` flag in weather responses), and the hosting and provider
dashboards. Re-baseline this document after the first month of real traffic and at each 10× step.

## 1. Usage assumptions

| Assumption                                | Value                                                                     | Why                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Sessions per MAU per month                | 6                                                                         | Planning is episodic; most users plan a few shoots a month                                  |
| Places explored per session               | 3                                                                         |                                                                                             |
| Place-days with a weather fetch per place | 1.5                                                                       | Only dates inside the 16-day horizon fetch; long-range dates are scenarios and cost nothing |
| Weather cache hit rate                    | 30 % at 100 MAU → 70 % at 100k MAU                                        | Cells and days are shared across users; popular places converge                             |
| Geocode queries per MAU per month         | 5                                                                         | Debounced, one per submitted query; coordinates and map clicks are free                     |
| Terrain/imagery tile egress per session   | 20–40 MB                                                                  | Served by the provider CDN, not by LightMap                                                 |
| App shell egress per session              | ~1.5 MB first load (Cesium chunk lazily loaded, ~3 MB, cached afterwards) |                                                                                             |
| Paid conversion                           | 5 % of MAU on Pro                                                         | Assumption for fee math only                                                                |
| Pro price (for fee math only)             | $9/month                                                                  | **Replace with the real price**                                                             |

Derived: weather requests before cache ≈ 6 × 3 × 1.5 = **27 per MAU per month**; after cache 8–19.

## 2. Why scrubbing costs nothing

- **Astronomy is client-side.** Sun, moon, twilight and golden-hour math runs in the browser in
  well under 16 ms; no server is involved.
- **One weather fetch per place-day.** The client asks for a whole civil day of hourly frames for a
  0.05° grid cell, caches it in TanStack Query, and interpolates locally. Dragging the timeline for
  an hour generates zero requests.
- **Long-range dates never fetch.** Beyond the horizon the mode is SCENARIO and the API refuses
  fetches anyway (422 `outside_horizon`).
- **Server cache is shared.** The same cell-day is fetched once for everyone
  (`provider_cache`, TTL 60 min).
- **Rendering is on the user's GPU.** No server render farm (plan §37).

The result is that cost scales with _places selected_, not with _time spent planning_.

## 3. Request budgets (from `packages/observability`)

Hard daily caps per client key, enforced in `usage_counters`; they bound the worst case per user.

| Resource                    | Anonymous | Free  | Pro                     |
| --------------------------- | --------- | ----- | ----------------------- |
| `weather` (calls/day)       | 40        | 150   | 600                     |
| `geocoder` (calls/day)      | 30        | 100   | 400                     |
| `imagery` (calls/day)       | 0         | 0     | 0 (no provider in v0.1) |
| `terrain_bytes` (bytes/day) | 300 MB    | 1 GB  | 5 GB                    |
| `preview` (renders/day)     | 200       | 1,000 | 5,000                   |

Plus a burst limit of 30 weather requests per minute per client. Cache hits are not charged against
budgets.

## 4. Cost lines

Prices below are indicative list prices as of writing and **must be verified** with each vendor
before budgeting.

| Line                                      | Basis                                                                                     | Notes                                                                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hosting** (Vercel / Fly.io class)       | Base plan + compute + egress                                                              | Next.js server routes are thin (cache lookups, proxying). Vercel Pro ~$20/seat + usage; Fly small machines $5–30 each.                                                                                                         |
| **Managed Postgres (+PostGIS)**           | Storage is tiny (viewpoints are rows, thumbnails optional); connections and IOPS dominate | Neon / Supabase / Fly Postgres: $0 dev → $19–69 → $300+ at scale                                                                                                                                                               |
| **Weather — Open-Meteo API subscription** | Calls per day after cache                                                                 | Free tier is non-commercial only. Commercial plans start **from ~€29/month**; higher tiers for more calls/day. **Verify current tiers and limits at open-meteo.com.**                                                          |
| **Terrain**                               | Tile egress from the provider                                                             | Re:Earth quantized-mesh: free, CC BY 4.0, best-effort SLA. Cesium ion World Terrain: per-plan pricing (commercial tiers roughly $150+/month; **verify at cesium.com/pricing**). Budget for ion from ~10k MAU when SLA matters. |
| **Imagery**                               | None by default (Natural Earth II bundled, public domain)                                 | Optional commercial XYZ provider (`IMAGERY_XYZ_URL`): budget line only when enabled; typical $0.5–2 per 1,000 tiles or a flat plan.                                                                                            |
| **Geocoding**                             | Requests                                                                                  | Nominatim is development-only. Commercial geocoder (e.g. per-request pricing ~$0.5–1 per 1,000 after a free allowance; **verify**).                                                                                            |
| **Stripe**                                | 2.9 % + $0.30 per successful card charge (typical US)                                     | Scales with **revenue**, not MAU: ≈ 3.3 % of MRR at a $9 price plus 30¢ per charge.                                                                                                                                            |
| **Error monitoring**                      | Sentry Team from ~$26/month; volume-based above                                           |                                                                                                                                                                                                                                |
| **Analytics**                             | Privacy-first vendor (Plausible/Fathom class) $9–19/month small, more at scale; or none   | Only sanitised events are sent (see `PRIVACY.md`)                                                                                                                                                                              |
| **Email (magic links)**                   | Transactional email; effectively free until tens of thousands/month                       |                                                                                                                                                                                                                                |

## 5. Estimates by scale (USD per month)

| Line                             | 100 MAU        | 1,000 MAU      | 10,000 MAU           | 100,000 MAU            |
| -------------------------------- | -------------- | -------------- | -------------------- | ---------------------- |
| Weather calls/month after cache  | ~1.9k          | ~16k           | ~110k                | ~800k                  |
| Hosting                          | 0–20           | 20–50          | 100–300              | 1,000–3,000            |
| Managed Postgres                 | 0–19           | 19–69          | 69–200               | 300–1,000              |
| Weather (Open-Meteo commercial)  | ~32 (€29)      | 32–110         | 110–330              | 330–1,100+ (custom)    |
| Terrain                          | 0 (Re:Earth)   | 0              | 0–200 (ion optional) | 500–2,000 (contracted) |
| Imagery (optional XYZ)           | 0              | 0              | 0–300                | 500–3,000              |
| Geocoding                        | 0–5            | 5–15           | 25–60                | 250–600                |
| Error monitoring + analytics     | 0–45           | 35–70          | 100–270              | 400–1,100              |
| **Infrastructure subtotal**      | **~35–120**    | **~110–320**   | **~400–1,660**       | **~3,300–11,800**      |
| Stripe fees (5 % conversion, $9) | ~3             | ~28            | ~280                 | ~2,800                 |
| **Total**                        | **~40–125**    | **~140–350**   | **~680–1,940**       | **~6,100–14,600**      |
| **Per MAU**                      | **$0.40–1.25** | **$0.14–0.35** | **$0.07–0.19**       | **$0.06–0.15**         |
| Revenue at assumptions           | 45             | 450            | 4,500                | 45,000                 |

Reading the table:

- At 100 MAU the fixed minimums (weather subscription, monitoring) dominate; the product is not
  meant to be profitable there.
- From ~1,000 MAU infrastructure is a small fraction of revenue at a 5 % conversion; the largest
  variable line becomes Stripe fees, which are proportional to revenue.
- Terrain and imagery are the lines most likely to change the picture at 10k+ MAU, because they
  depend on contracts rather than list prices. Re:Earth's free terrain is best-effort; a paid SLA
  is a business decision to be made when the traffic justifies it.
- Weather cost is bounded by budgets even under abuse: 100k MAU × worst case is not possible
  because anonymous users are capped at 40 calls/day and the cache absorbs repeats.

## 6. What would break this model

- A UI change that fetches weather per timeline tick or per camera move (guarded by the E2E smoke
  check "no request per scrub").
- Enabling a per-tile-priced imagery provider without the `terrain_bytes`/`imagery` budgets.
- Server-side rendering of previews (explicitly out of scope, plan §37).
- Storing thumbnails at high resolution for every viewpoint: keep them ≤ 100 KB or optional.

## 7. Measuring

- `SELECT resource, day, SUM(count) FROM usage_counters GROUP BY 1,2` — calls per resource per day.
- Weather response `cached: true/false` ratio in logs — cache hit rate.
- Provider dashboards — actual billed calls and egress.
- Hosting dashboard — egress and compute; compare with sessions from analytics.

Update §1 and §5 with the measured values and date the revision.

## 7. Reading actual usage

`pnpm usage:report -- --days 14` prints daily totals per budgeted resource from `usage_counters`
(total, distinct keys, the busiest key's share, the Pro daily budget for comparison); `--json`
for dashboards. Aggregates only — no user keys leave the database. Compare the `weather` and
`climatology` totals with the provider's own usage page monthly; a busiest-key share above ~30 %
on a resource means one client is dominating and the budgets in `DAILY_BUDGET_LIMITS` should be
reviewed.

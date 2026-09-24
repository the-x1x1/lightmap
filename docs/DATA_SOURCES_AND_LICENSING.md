# Data sources and licensing

**Mandatory before launch (plan §12, §14).** Every external data source LightMap can touch is
listed here with its licence, attribution requirement, commercial-use status, caching and retention
rules, expected cost and replacement option. Data licences are separate from code licences; code
is covered by `THIRD_PARTY_NOTICES.md` and `scripts/check-licenses.ts`.

`scripts/check-attribution.ts` fails CI if a provider id used in code has no row here (the id is
matched as a backticked code span) or ships an empty attribution string.

Review states: **approved** (commercial use permitted under documented terms, attribution wired),
**conditional** (permitted only with a contract/plan/key the owner must obtain), **development-only**
(never in production; env validation enforces), **blocked**.

## Summary table

| Id                                                          | Purpose                                               | Licence                                                                                                                              | Attribution required                                                         | Commercial use                                                       | Server cache                                                                         | Retention            | Cost                                                                                   | Replacement                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `natural-earth-ii`                                          | Default basemap, bundled with CesiumJS (levels 0–2)   | Public domain                                                                                                                        | Courtesy credit shown                                                        | Yes                                                                  | Yes (bundled)                                                                        | n/a                  | $0                                                                                     | Any XYZ imagery                                                                                 |
| `reearth-mapterhorn-terrain`                                | Default terrain (quantized mesh) + elevation lookup   | DEM: Mapterhorn CC BY 4.0; geoid EGM2008 public domain                                                                               | **Yes** — "Terrain: Re:Earth · Mapterhorn (CC BY 4.0) · EGM2008 (NGA)"       | Yes (CC BY)                                                          | Tiles cached by Cesium in-browser; server caches elevation lookups 30 d              | Elevation cache only | $0; best-effort service, no SLA                                                        | `cesium-world-terrain`                                                                          |
| `cesium-world-terrain`                                      | Terrain via Cesium ion (asset 1)                      | Cesium ion terms, per plan                                                                                                           | Yes ("Cesium World Terrain © Cesium ion")                                    | Conditional — needs an ion commercial plan                           | Not server-cached (terms)                                                            | none                 | Per ion plan (verify at cesium.com/pricing)                                            | `reearth-mapterhorn-terrain`                                                                    |
| `cesium-ion-imagery`                                        | Bing Aerial via Cesium ion (asset 2)                  | Cesium ion / Microsoft terms                                                                                                         | Yes                                                                          | Conditional — ion commercial plan                                    | No                                                                                   | none                 | Per ion plan                                                                           | `xyz-imagery`                                                                                   |
| `xyz-imagery`                                               | Operator-configured imagery (MapTiler, Mapbox, Esri…) | Per contract                                                                                                                         | **Yes** — `IMAGERY_XYZ_ATTRIBUTION` required by env validation               | Conditional — per contract                                           | No by default                                                                        | none                 | Per contract (budget line in COST_MODEL)                                               | another XYZ vendor                                                                              |
| `open-meteo`                                                | Hourly forecast (16 d) and recent archive (92 d)      | CC BY 4.0 on the free tier, **non-commercial only**; commercial requires an Open-Meteo API subscription                              | **Yes** — "Weather data by Open-Meteo.com"                                   | Conditional until `OPEN_METEO_API_KEY` (customer endpoint) is set    | Yes: one civil day per 0.05° cell, TTL = model update interval (60 min); archive 6 h | Cached frames only   | Free tier for dev; commercial plans from ~€29/month (verify open-meteo.com/en/pricing) | Any provider behind `WeatherProvider` (Tomorrow.io, Meteomatics, Visual Crossing)               |
| `nominatim`                                                 | Place search / reverse geocoding                      | ODbL 1.0 data © OpenStreetMap contributors; **Nominatim usage policy**: ≤1 req/s, identifying User-Agent, no heavy or commercial use | **Yes** — "© OpenStreetMap contributors"                                     | **Development-only**                                                 | Yes: by normalised query 7 d; reverse by 0.01° cell 30 d                             | Cache only           | $0                                                                                     | Contracted geocoder (Geoapify, OpenCage, MapTiler Geocoding, Mapbox) behind `GeocodingProvider` |
| `geo-tz`                                                    | Coordinate → IANA time zone (server)                  | Code MIT; data ODbL (timezone-boundary-builder, derived from OSM)                                                                    | Yes — "Time zone boundaries © timezone-boundary-builder contributors (ODbL)" | Yes (we do not redistribute or modify the database)                  | In-process                                                                           | n/a                  | $0                                                                                     | Open-Meteo `timezone=auto` field, or a commercial geocoder's zone field                         |
| `fixture-geocoder`, `fixture-timezone`, `fixture` (weather) | Deterministic development data                        | Proprietary test data                                                                                                                | n/a (labelled "not a forecast / not a live source")                          | **Development-only**                                                 | n/a                                                                                  | n/a                  | $0                                                                                     | n/a                                                                                             |
| `ellipsoid`                                                 | Flat WGS84 ellipsoid (no terrain)                     | n/a                                                                                                                                  | none                                                                         | Yes                                                                  | n/a                                                                                  | n/a                  | $0                                                                                     | any terrain                                                                                     |
| Real-reference imagery                                      | Phase 5                                               | —                                                                                                                                    | —                                                                            | **Blocked**: no provider contract; `REFERENCE_IMAGERY_PROVIDER=none` | —                                                                                    | —                    | —                                                                                      | Licensed provider behind `ImageryProvider`                                                      |

## Source notes

### Natural Earth II (bundled)

Ships inside `@cesium/engine` (`Assets/Textures/NaturalEarthII`), public domain, three zoom levels.
It is the always-present fallback layer, so imagery failure never leaves a black globe. It is
coarse; with only this basemap the confidence panel marks _Scene detail: Low_ and the label is
_Estimated Preview_. Verified: naturalearthdata.com/about/terms-of-use.

### Re:Earth Terrain (Mapterhorn)

`https://terrain.reearth.land/cesium-mesh/ellipsoid`. Site text (read 2026-09): "no tokens, no
signup", "best-effort uptime, no SLA", may add rate limits without notice. DEM is Mapterhorn
(CC BY 4.0; underlying sources listed at download.mapterhorn.com/attribution.json), geoid EGM2008
(public domain). CC BY requires attribution, which the footer and Cesium credit display carry. The
prior review in the owner's WorldView repository (`config/licenses/providers.json`,
`reearth-terrain-mapterhorn`, approved 2026-09-21) reached the same conclusion; we re-verified
rather than inherited it. Operational rule: on failure fall back to the ellipsoid and mark terrain
confidence LOW — never fail the page.

**Open item:** confirm whether Mapterhorn requires per-source credit from `attribution.json` in an
About screen. Until confirmed, the footer credits Mapterhorn generically.

### Cesium ion (World Terrain, Bing imagery)

Requires an ion account and, for commercial use, a paid plan; token is set via `CESIUM_ION_TOKEN`
and used server-side only for descriptors — note Cesium's client loads ion assets directly, so the
token is _public_ by ion's design; use an ion token scoped to the production domain. Conditional
until the owner holds a commercial plan. Terms: cesium.com/legal/terms-of-service.

### Open-Meteo

Free tier: CC BY 4.0, non-commercial, 10,000 calls/day soft limit. Commercial: API subscription,
`customer-api.open-meteo.com` with `apikey`. `OpenMeteoProvider.getCapabilities().commercialReview`
reports `approved` only when a key is present; env validation warns in production without one.
Attribution string is provider-mandated wording. We request `timezone=UTC` and normalise; we never
store raw responses beyond the normalised frames.

### Nominatim

The OSMF usage policy (operations.osmfoundation.org/policies/nominatim) is explicit that the public
service is not for commercial apps or autocomplete bursts. The adapter enforces 1 req/s per process,
sends `GEOCODER_USER_AGENT`, and the search box debounces 450 ms. `review: development-only`; env
validation warns in production. Before launch, replace with a contracted geocoder implementing the
same `GeocodingProvider` interface — the UI does not change.

### geo-tz / timezone-boundary-builder

ODbL requires attribution and share-alike _for derived databases_. LightMap uses the boundaries as
a lookup and does not modify or redistribute the database, so attribution is the operative
obligation; it is in the footer and THIRD_PARTY_NOTICES.

### Stripe

Not a data source, but PII flows to it (email, payment). Covered by Stripe's DPA; see PRIVACY.md.

## Rules encoded in code

- A `conditional` or `development-only` source is never the default (`registry.ts`).
- A source that needs a credential is unavailable without it — the registry silently degrades to
  the approved default and the confidence panel says so.
- Every imagery source must have an attribution string (`env.ts` refuses `IMAGERY_PROVIDER=xyz`
  without `IMAGERY_XYZ_ATTRIBUTION`).
- No imagery is downloaded, stored or re-served by LightMap servers. Cesium's in-browser tile
  cache is the provider's own client behaviour.
- Nothing is scraped from Google Maps/Street View, Instagram, Flickr or similar (plan §7).

## Code licences

Handled by `scripts/check-licenses.ts` against `scripts/license-allowlist.json`: permissive
licences pass; anything else (GPL/AGPL/LGPL/SSPL/unknown) fails CI unless an exception with a
written reason is recorded. An exception key may end in `*` to cover platform-split packages.
`THIRD_PARTY_NOTICES.md` is regenerated with `pnpm licenses --write-notices` (it is a generated
file, excluded from Prettier).

Recorded exceptions (both awaiting the owner's written confirmation):

| Package        | Licence                                       | Why it is acceptable                                                                                                                                                                                         |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `geo-tz`       | MIT code; ODbL timezone-boundary data         | Attribution carried; the database is used unmodified and not redistributed.                                                                                                                                  |
| `@img/sharp-*` | `LGPL-3.0-or-later` (libvips prebuilt binary) | Optional dependency of Next.js for `next/image`; never imported by LightMap code; unmodified native module loaded server-side only, never shipped to browsers. Weak copyleft does not reach LightMap's code. |

## Pre-launch checklist

- [ ] Open-Meteo commercial subscription active; `OPEN_METEO_API_KEY` set.
- [ ] Geocoder contract signed; `GEOCODER_PROVIDER` switched off `nominatim`.
- [ ] Imagery: either accept Natural Earth II (coarse) or configure `xyz`/ion with a commercial plan.
- [ ] Terrain: decide Re:Earth (free, best-effort) vs Cesium World Terrain (paid, SLA).
- [ ] Mapterhorn per-source attribution question resolved.
- [ ] Attribution footer reviewed on desktop and mobile.
- [ ] `THIRD_PARTY_NOTICES.md` regenerated from the release lockfile.

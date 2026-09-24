# ADR-0003: Provider interfaces, registry and credential-free descriptors

**Status:** Accepted · **Date:** 2026-09 · **Plan:** §7, §12, §14, §33

## Context

LightMap depends on external data for everything except astronomy: geocoding, time zones, terrain,
basemap tiles, weather, and (later) reference imagery. The plan requires no data-source lock-in,
server-side credentials, first-class licensing, and that fixtures never masquerade as live data.
Vendors will change: the development geocoder (Nominatim) is not licensed for a commercial app, the
weather provider's free tier is non-commercial, and terrain may move from a free best-effort CDN to
a contracted one.

## Decision

1. **One interface per external concern**, in `packages/geospatial/src/providers/types.ts` and
   `packages/weather/src/model.ts`: `GeocodingProvider`, `TimezoneProvider`, `TerrainProvider`,
   `MapTileProvider`, `ImageryProvider`, `WeatherProvider`. UI components never import a vendor SDK;
   API routes and the scene builder call interfaces.
2. **A registry selects implementations from the validated environment**
   (`createGeospatialProviders(env)`, `createWeatherProvider(env)`), server-side only. It is the
   only code that knows which vendor sits behind which interface, and it refuses to make a
   `conditional` or `development-only` source the default in production.
3. **The browser receives descriptors, never credentials.** `TerrainDescriptor` and
   `BasemapDescriptor` carry a kind, a public URL or asset id, and attribution. Secrets stay in
   server routes; a browser-usable token (Cesium ion) is the only kind that may be sent, and only
   when the provider is designed for it.
4. **`ProviderMeta` travels with every implementation**: id, name, attribution text and URL,
   licence, terms URL, `review` state (`approved | conditional | development-only | blocked`),
   `isFixture`, and cache policy (`allowed`, `maxAgeSeconds`). The UI renders attribution from it;
   `scripts/check-attribution.ts` fails CI if a registered source lacks it; the confidence panel
   reads `isFixture` to show the development banner.
5. **Fixtures exist for development and tests only.** `FixtureGeocoder`, `FixtureTimezoneProvider`,
   the fixture weather provider and the ellipsoid terrain are labelled `isFixture: true`; env
   validation **refuses fixture weather and geocoding in production**. Production never silently
   uses fake data.
6. **Cache keys are quantised** at the provider boundary (0.05° weather grid cell, 0.01° reverse
   geocode cell, normalised query text) and respect `meta.cache`.

## Consequences

- Swapping Nominatim for a commercial geocoder, or Open-Meteo for another model, is a new adapter
  file plus a registry case; no UI or scene code changes.
- Attribution and licensing are enforceable in CI rather than remembered.
- Every provider call site is mockable; the scene, controller and API tests use fake providers.
- A little ceremony: adding a source means writing meta, an adapter, a registry case, a
  `DATA_SOURCES_AND_LICENSING.md` row and tests. This is intentional friction.
- Reference imagery is `null` in the registry until a licensed provider exists; every UI surface
  must tolerate that.

## Alternatives considered

- **Call vendor SDKs directly from routes/components.** Fastest today; makes vendor changes a
  cross-cutting rewrite and hides licensing state in scattered code.
- **A generic "DataSource" plugin system with runtime discovery.** Over-engineered for six
  concerns; explicit interfaces are simpler and type-checked.
- **Port WorldView's provider catalog.** Its entries (PMTiles packs, offline styles, operator
  feeds) are WorldView-specific; only the shape (review state, credential requirement, terms URL)
  was adopted, with LightMap's own entries (see the reuse audit).

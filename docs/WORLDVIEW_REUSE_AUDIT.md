# WorldView Reuse Audit

**Audit date:** 2026-09-24
**Audited repository:** the owner's `worldview` checkout (`github.com/the-x1x1/oneview`, HEAD `e7622a35`, "Merge feature/connector-architecture … 0.2.0").
**Auditor:** Claude, pre-build (Work Order STEP 0).
**Rule applied:** the LightMap plan, §0A. _The destination architecture wins._

## Verdict in one paragraph

LightMap is a fresh application. Of WorldView's 25 packages, 14 providers, 11 tools and the
Electron desktop app, **five small owner-authored modules (≈ 400 lines total) were ported**,
all of them generic math or capability plumbing, all rewritten against LightMap's own types and
each covered by new tests. **Nothing WorldView derived from God's Eye View was copied.** No
WorldView domain concept (WorldObject, WorldEvent, LayerManager, ObservationStore, tracked
entities, lenses, connectors, world packs, history store) exists in LightMap, and LightMap has
no runtime dependency on WorldView. The rest of WorldView's map stack was used as a _reference_
for decisions that are recorded here and in the ADRs, not as source.

## Provenance facts that decided the audit

1. WorldView's application foundation is itself derived from the open-source **God's Eye View
   (GEV)** project (`UPSTREAM.md`: base commit `0dbde1e3`, 2026-09-20, imported 2026-09-21).
2. GEV's `LICENSE` (verified 2026-09-24 at `github.com/bilawalsidhu/gods-eye-view/blob/main/LICENSE`)
   is **MIT, Copyright (c) 2026 Bilawal Sidhu**, and states that the grant **covers source
   code only**; bundled datasets and assets carry their own licences, several of them
   non-commercial (TeleGeography CC BY-NC-SA, a CC BY-NC event pack, Google-derived heights).
3. WorldView marks GEV-derived files with a header (`Adapted from gods-eye-view … (MIT)`). In the
   map stack those are: `render-cesium/src/viewer.ts`, `terrain.ts`, `imagery.ts`,
   `attribution.ts`, `basemaps.ts`, and (by its own note) `google3d.ts`. Everything else in
   `render-cesium`, `render-core`, `render-maplibre`, `world-model` and `apps/desktop/src/renderer`
   carries no such header and is owner-authored.
4. WorldView's own packages are marked `"license": "MIT"` in every `package.json`; the owner is
   the same person who owns LightMap.

Classification legend (from the plan): **A** owner-authored generic · **B** owner-authored but
WorldView-specific · **C** third-party dependency wrapper · **D** third-party-derived source ·
**E** unknown provenance.

## Modules ported into LightMap

Every row below is first-class LightMap code now: rewritten against LightMap types, with
WorldView naming removed, and tested in LightMap's own suite.

| #   | WorldView original                                                                                                                                                  | LightMap destination                        | Class | Why reused                                                                                                                                                                                                                  | Modified?                                                                                                                                                                                                                                | Deps              | Licence / provenance                             | WorldView behaviour removed                                                                           | Tests added                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `packages/world-model/src/geo.ts` — `normalizeLongitude`, `isValidLatLon`, `haversineMeters`, `bearingDegrees`, `clampBounds`                                       | `packages/geospatial/src/geo.ts`            | A     | Correct, boring WGS84 helpers LightMap needs for coordinate parsing, pin distance and validation.                                                                                                                           | Yes — reduced to five functions, `GeoPosition` altitude datum enum dropped, bounds type simplified.                                                                                                                                      | none              | Owner-authored (no GEV header). MIT, same owner. | `GeoRegion`, admin regions, polygon/ring helpers, `WorldGeometry` (WorldView's observation geometry). | `packages/geospatial/tests/geo.test.ts`            |
| 2   | `packages/render-cesium/src/view.ts` — `normalizeHeadingDegrees`, `altitudeForBounds`; `packages/render-core/src/contract.ts` — `zoomToAltitudeM`, `altitudeToZoom` | `packages/renderer/src/camera-math.ts`      | A     | Proven camera-altitude ↔ web-mercator-zoom conversions and framing math; saves a class of "fly-to lands at the wrong height" bugs.                                                                                          | Yes — consumes LightMap `CameraState`; the `ViewState`/IPC bounds clamping is gone.                                                                                                                                                      | none              | Owner-authored (no GEV header).                  | `ViewState`, IPC contract, `resolveFlyTarget`'s renderer-host coupling.                               | `packages/renderer/tests/camera-math.test.ts`      |
| 3   | `packages/render-cesium/src/renderer.ts#surfacePosition` + `picking.ts` (the resolution order `pickPosition` → `pickEllipsoid` → `Cartographic`)                    | `packages/renderer/src/pick.ts`             | A     | The click-to-coordinate path that works with and without terrain, already debugged on real hardware.                                                                                                                        | Yes — feature/entity picking removed (LightMap has one pin, no feature layers); returns a plain `GeoPoint`.                                                                                                                              | Cesium (injected) | Owner-authored.                                  | `RenderFeature` store lookups, hover, feature ids, reference-label filtering.                         | `packages/renderer/tests/pick.test.ts`             |
| 4   | `packages/render-core/src/performance.ts` — `PerformanceGovernor`, `budgetLadderIsMonotone`                                                                         | `packages/renderer/src/quality-governor.ts` | A     | An FPS-driven quality ladder with asymmetric hysteresis and climb penalties is exactly the "adaptive terrain / shadow quality on mobile" requirement (plan §27), and this one has been tuned against real oscillation bugs. | Yes — generic over a `QualityRung` (`shadowMapSize`, `terrainScreenSpaceError`, `resolutionScale`, `softShadows`) instead of feature counts and detail levels; the "would the next rung change anything" guard now compares rung fields. | none              | Owner-authored.                                  | Feature caps, presentation detail levels, `featureCeiling`.                                           | `packages/renderer/tests/quality-governor.test.ts` |
| 5   | `packages/render-core/src/renderer-host.ts#resolveRenderMode`, `apps/desktop/src/renderer/main.tsx#detectCapabilities`, `apps/desktop/src/renderer/map/gpu-info.ts` | `packages/renderer/src/capabilities.ts`     | A     | WebGL2 probe, low-power heuristic and GPU renderer string, in one testable function with a throwaway context that is released.                                                                                              | Yes — result feeds LightMap's quality selection (`3D globe` vs `Quality 0 map overlay`) rather than a 2D/3D renderer swap.                                                                                                               | browser APIs      | Owner-authored.                                  | Offline/world-pack mode preference, Electron IPC.                                                     | `packages/renderer/tests/capabilities.test.ts`     |

## Patterns adopted (no code copied)

| WorldView source                                                                                                      | Decision in LightMap                                                                                                                                                                                                                                                                                                                                                                                                                               | Class           | Notes                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render-cesium/src/cesium-like.ts`, `cesium-module.ts`                                                                | **Pattern adopted, interface rewritten.** LightMap's `CesiumLike` is ~40 members (the widget, camera, globe, light, shadow map, post-process stages, terrain/imagery factories) instead of WorldView's data-layer surface (billboards, labels, polylines, ground primitives).                                                                                                                                                                      | A               | Two findings carried over as decisions: (a) import `@cesium/engine`, never `cesium` — the `cesium` meta-package pulls in `@cesium/widgets` and Knockout, whose module-scope `eval` breaks a strict CSP (ADR-0002); (b) keep exactly one file typed against Cesium's declarations so tests can substitute plain objects. |
| `render-core/src/map-providers.ts` (catalog with `review: approved \| conditional`, `requiresCredential`, `termsUrl`) | **Shape adopted; entries are LightMap's own.** `packages/geospatial/src/providers/registry.ts` records each basemap/terrain source with its commercial review state, credential requirement and attribution, and refuses to make a `conditional` source the default.                                                                                                                                                                               | B               | WorldView's entries (PMTiles world packs, offline dark/light styles, Esri as an operator choice) are not carried over.                                                                                                                                                                                                  |
| `render-cesium/src/basemaps.ts` — tile-failure fallback to the bundled Natural Earth II                               | **Concept reimplemented.** LightMap's imagery stack falls back to Cesium's bundled Natural Earth II when the configured provider fails, and the confidence panel downgrades _Environment_ to LOW when that happens.                                                                                                                                                                                                                                | D (GEV-derived) | Not copied; the fallback is three lines around `ImageryLayer.errorEvent`.                                                                                                                                                                                                                                               |
| `render-cesium/src/viewer.ts` — widget options                                                                        | **Read, then deliberately diverged.** WorldView turns globe lighting _off_ and ground atmosphere _off_ because it shows the whole world at once. LightMap's entire purpose is lighting, so it turns both on and drives `scene.light` from `SolarState`. Kept as decisions: `CesiumWidget` (not `Viewer`), `msaaSamples: 4`, `preserveDrawingBuffer: true` (thumbnails), capped `resolutionScale`, `minimumZoomDistance`, no `targetFrameRate` cap. | D (GEV-derived) | The trackpad-pinch relay in that file corresponds to GEV PR #284 and was not ported; Cesium ≥ 1.140 handles ctrl-wheel pinch natively.                                                                                                                                                                                  |
| `render-cesium/src/terrain.ts`                                                                                        | **Reimplemented (trivial).** LightMap's `TerrainProvider` adapter needs a height sampler as well as a Cesium terrain factory, so it is a different interface.                                                                                                                                                                                                                                                                                      | D (GEV-derived) | The provider facts (Re:Earth/Mapterhorn quantized-mesh URL, CC BY 4.0, ion World Terrain needs a token) are data, recorded in `docs/DATA_SOURCES_AND_LICENSING.md` with WorldView's `config/licenses/providers.json` review cited as prior art.                                                                         |
| `config/licenses/*.json`, `docs/legal/COMMERCIAL-DISTRIBUTION-REVIEW.md`                                              | **Used as evidence.** The review conclusions for Re:Earth terrain (approved, CC BY 4.0, best-effort SLA), Natural Earth II (public domain), Esri World Imagery (conditional), OSM raster tiles (usage policy forbids app-scale use) informed `docs/DATA_SOURCES_AND_LICENSING.md`.                                                                                                                                                                 | —               | Data licences are re-verified there against the providers' own pages, not taken on WorldView's word.                                                                                                                                                                                                                    |

## Explicitly not ported

Everything below is either WorldView product/domain code (B) or GEV-derived (D) with no LightMap
requirement behind it. None of it exists in LightMap in any form.

- **Domain model:** `world-model` (WorldObject, WorldEvent, observation, provenance, freshness,
  identifiers, validate), `identity`, `state-engine`, `event-engine`, `history-store`,
  `hot-spatial-index`, `query-engine` (search grammar, gazetteer, place duplicates).
- **Data plane:** every `providers/*` (ADS-B, AIS, CelesTrak, FIRMS, NHC, USGS, cameras,
  weather-for-operators, infrastructure), `provider-sdk`, `provider-runtime`, `connector-sdk`,
  `connector-runtime`, `source-health`, `camera-gateway` (CCTV/go2rtc), `offline` (world packs,
  signatures, place index), `updater`, `diagnostics`, `ipc-contract`, `runtime`, `config`
  (Electron settings store).
- **Rendering of data layers:** `render-core` presentation pipeline, lenses, icons, motion,
  scheduler, reference overlays; `render-cesium` layers (billboards, labels, polylines, density,
  entities, depth), `horizon.ts` (marker occlusion — LightMap has one pin), `attribution.ts`
  CreditSync (Cesium's own `CreditDisplay` suffices), `google3d.ts`, `reference-tiles.ts`,
  `labelDeclutter.ts`, `featureRouter.ts`, `sprites.ts`, `theme.ts`.
- **MapLibre stack:** all of `render-maplibre`. LightMap uses one renderer (ADR-0002).
- **2D/3D renderer switching:** `renderer-host.ts` beyond the capability probe. LightMap's
  fallback is the Quality 0 overlay inside the same page, not a second renderer.
- **UI:** the whole `packages/ui` (its timeline is a playback/replay control with availability
  marks and speeds; LightMap's timeline is a solar-day scrubber), the desktop shell, dialogs,
  command palette, diagnostics dialog, tile cache, CSP module.
- **WorldView's third-party-derived tests** retained from GEV.

## The Efficiency Rule checklist (plan §0A)

| Before writing…                        | WorldView has it?                                                           | Outcome                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cesium camera controller               | Only Cesium's own `ScreenSpaceCameraController` plus fly-to/framing helpers | Helpers ported (#2). First-person viewpoint camera written fresh (`packages/renderer/src/viewpoint-camera.ts`), because WorldView has no eye-level camera. |
| MapLibre map shell                     | Yes                                                                         | Not needed — single renderer.                                                                                                                              |
| 2D/3D map switch                       | Yes                                                                         | Not needed — see above.                                                                                                                                    |
| Coordinate picker                      | Yes                                                                         | Ported (#3).                                                                                                                                               |
| Terrain adapter                        | Yes (GEV-derived)                                                           | Reimplemented (trivial, different interface).                                                                                                              |
| Map provider registry                  | Yes                                                                         | Shape adopted, entries rewritten.                                                                                                                          |
| Map attribution UI                     | Yes (GEV-derived)                                                           | Cesium `CreditDisplay` + a small LightMap `AttributionFooter` component.                                                                                   |
| Renderer capability/fallback detection | Yes                                                                         | Ported (#5).                                                                                                                                               |

## How to verify this audit

- `git log --follow` on any file listed under _ported_ shows it was authored in the LightMap
  repository; the WorldView path is cited in the file header comment.
- `grep -ri "worldview\|gods-eye\|@worldview" packages apps` returns only these header
  citations and the ADRs.
- `pnpm test --filter @lightmap/geospatial --filter @lightmap/renderer` runs the tests listed
  in the table.
- `pnpm licenses:check` (see `scripts/check-licenses.ts`) shows no `@worldview/*` package.

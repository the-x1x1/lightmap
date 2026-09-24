# ADR-0002: CesiumJS via `@cesium/engine` as the single renderer

**Status:** Accepted · **Date:** 2026-09 · **Plan:** §6, §10, §13, §27 · **Audit:** `docs/WORLDVIEW_REUSE_AUDIT.md`

## Context

The MVP needs a 3D globe with real terrain, directional sunlight whose direction is exactly the
astronomical sun, shadows where hardware allows, a sky that responds to time of day, and a
post-process that makes Clear / Partly Cloudy / Overcast obviously different. It must run on phones,
under a strict Content Security Policy, and degrade to a usable map overlay when WebGL is missing.
The plan says: one geospatial rendering stack; do not add both Cesium and MapLibre without a concrete
need.

The WorldView audit surfaced a decisive finding: the `cesium` meta-package pulls in
`@cesium/widgets` and **Knockout**, whose module-scope `eval` requires `'unsafe-eval'` in
`script-src`, which breaks a strict CSP.

## Decision

1. **CesiumJS through `@cesium/engine` only**, using `CesiumWidget` (not `Viewer`). No
   `@cesium/widgets`, no Knockout. Production CSP is `script-src 'self' 'wasm-unsafe-eval' blob:`
   — `'wasm-unsafe-eval'` and `blob:` are for Cesium's Web Workers and Draco/KTX decoders;
   `'unsafe-eval'` is only added in development.
2. **Single renderer.** No MapLibre. The 2D fallback is the **Quality-0 map lighting overlay**
   inside the same page (sun arrow, shadow arrow, time, twilight band, cloud state, sky gradient),
   which is always available and is also the render path when `detectCapabilities()` reports no
   usable WebGL2.
3. **`DirectionalLight` driven by LightMap's own `SolarState`**, not Cesium's `SunLight`.
   `sun-vector.ts` converts azimuth/elevation at the pin into an ECEF direction (unit tested) and
   `lighting.ts` maps `SceneState` to light colour, intensity, shadow darkness, fog and grade
   uniforms. The renderer and the UI therefore share one source of truth for where the sun is.
   Cesium's own ephemeris is used **only as a cross-check** in the development performance panel
   ("Sun vs Cesium ephemeris").
4. **Post-process grade stage** (`shaders/grade.frag.ts`) implements the weather scenario:
   procedural cloud over sky pixels, haze, contrast/saturation/colour-temperature grade,
   overcast/night dimming, rain streaks. It never moves geometry or the light.
5. **One file typed against Cesium.** `cesium/cesium-host.ts` is the only module that imports
   `@cesium/engine`; everything else talks to a ~40-member `CesiumLike` interface so the controller
   is unit tested against plain objects (`controller.test.ts`). Widget options follow the audit's
   decisions: `msaaSamples: 4`, `preserveDrawingBuffer: true` for thumbnails, capped
   `resolutionScale`, globe lighting and ground atmosphere **on** (WorldView turns them off; our
   purpose is lighting).
6. **Quality ladder and governor.** `RenderSettings.quality` 0–3; an FPS-driven `QualityGovernor`
   (ported from WorldView, rewritten) adjusts shadow map size, terrain screen-space error, resolution
   scale and soft shadows with hysteresis. The Cesium chunk is lazily loaded and must not be in the
   first-load bundle (`scripts/check-bundle.ts`).

## Consequences

- Strict CSP in production with no `unsafe-eval`; verified by the release smoke check.
- One rendering mental model, one set of camera math, one attribution path (`CreditDisplay`).
- Losing `Viewer` means no bundled Cesium UI (timeline, base-layer picker, geocoder). None of it was
  wanted; LightMap's UI is its own.
- The sun in the scene is exactly the sun in the confidence panel and the E2E assertions; there is
  no possibility of the renderer disagreeing with the astronomy package.
- Cesium's engine is large (~3 MB gzipped chunk); it is loaded on demand and cached. Low-end devices
  fall to Quality 0 automatically.
- Physically based atmosphere, volumetric clouds and water are Phase 4 work on top of the grade
  stage, not replacements for it.

## Alternatives considered

- **`cesium` meta-package with `Viewer`.** Rejected: Knockout's `eval` forces `'unsafe-eval'`;
  ships UI we do not use.
- **MapLibre GL for 2D plus Cesium for 3D (WorldView's architecture).** Rejected: two renderers,
  two camera models, two attribution paths, larger bundle; the plan forbids it without a concrete
  need, and the Quality-0 overlay covers the 2D case.
- **Three.js with a custom terrain loader.** Full control, but re-implements terrain streaming,
  geodesy and imagery layering that Cesium has spent a decade on.
- **deck.gl / MapLibre 3D terrain.** Good for data layers, weaker for globe-scale terrain with
  shadow mapping and per-pixel sun lighting.
- **Cesium `SunLight` (its built-in ephemeris).** Rejected as the source of truth: two ephemerides
  in one product would eventually disagree at the sub-degree level, and the UI's numbers must be the
  renderer's numbers. Kept as a debug cross-check.

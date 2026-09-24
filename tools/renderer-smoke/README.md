# Renderer smoke test

Runs LightMap's real renderer code (`packages/renderer`: `SceneController`, `CesiumSceneHost`,
the grade post-process shader) inside headless Chromium against a bundled CesiumJS build, with no
network: ellipsoid terrain and the bundled Natural Earth II basemap.

It applies ten scenes for Kailua Beach on 31 May 2026 — noon clear, noon overcast, golden hour
(18:45, viewpoint), blue hour (19:30), partly cloudy afternoon, moonlit night (23:00, full moon),
storm, two forecast-frame scenes at 19:18 (Sun ≈ −2.4°) with only a cirrus deck and only a
stratus deck, and a **shadow probe** at 18:15 (Sun ≈ 11°): a 20 m tower on flat ground seen from
above — and screenshots each. The shadow scene is measured, not just looked at: ground luminance
along the shadow line must be < 70 % of the Sun side, and the point just beyond `h / tan(el)` must
be as bright as the Sun side (direction, length and "no fade at low Sun" in one check). Any runtime exception, shader compile error or missing screenshot
fails the run. `docs/media/renderer-smoke-2026-09-24c.png` is the contact sheet from the run that
validated the layered cloud decks (SwiftShader software GL, so colours are exact but performance is not).

```sh
pnpm install
cd tools/renderer-smoke
pnpm exec tsc -p tsconfig.emit.json                      # emits packages → www/dist (ESM)
ln -s ../../../node_modules/cesium/Build/Cesium www/cesium-build
node run.mjs
```

`www/index.html` uses an import map so the emitted packages and Cesium load as native ES modules;
nothing is bundled. The `cesium` meta-package is a **devDependency only**, used for its prebuilt
`Build/Cesium` bundle here; application code imports `@cesium/engine` (ADR-0002).

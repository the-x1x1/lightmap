# Renderer smoke test

Runs LightMap's real renderer code (`packages/renderer`: `SceneController`, `CesiumSceneHost`,
the grade post-process shader) inside headless Chromium against a bundled CesiumJS build, with no
network: ellipsoid terrain and the bundled Natural Earth II basemap.

It applies twelve scenes for Kailua Beach on 31 May 2026 — noon clear, noon overcast, golden hour
(18:45, viewpoint), blue hour (19:30), partly cloudy afternoon, moonlit night (23:00, full moon),
storm, the same storm with the **physical dome** experiment on (`render.physicalSkyDome`: the
dome's Mie density from the sky model — judge it against the plain storm shot before enabling the
flag), two forecast-frame scenes at 19:18 (Sun ≈ −2.4°) with only a cirrus deck and only a
stratus deck, a **terrain-path** scene, a **ground-texture** probe (the procedural ground material compiled on a flat primitive with a synthetic land-cover map switched on — the shot must show forest at the rectangle's north-west, crop north-east, built-up south-west, bare south-east and an ice patch, which checks the cover map's orientation through Cesium's own upload — then two close-up shots, `ground-detail` and `ground-detail-turned`, of the detail atlas 40 m from the pin from two headings: a grass grain with no visible grid that stays put as the orbit turns — and the real globe program — Cesium's GlobeVS/GlobeFS with `APPLY_MATERIAL`, the water mask, lighting, fog and the ground atmosphere — compiled and linked on the scene's GL context, since the ellipsoid carries no vertex normals and the globe itself does not apply the material here; any shader error fails the run), a **synthetic terrain** stage (`www/synthetic-terrain.js`: quantized-mesh tiles from an analytic height field — sea to the west, a beach at the pin, an 800 m ridge 3.5 km east — with oct-encoded vertex normals and a water mask, so the globe itself applies the ground material and draws water; six `synth-*` shots; the two map views are still framed on the sea and `synth-golden-ridge` is taken before its tiles load, both to fix), a **water probe** (a rectangle of sea at sea level around the pin, the same material with the globe's own defines and a fragment shader that blends and lights it as GlobeFS does, with the lighting's sky-in-the-water colours; five viewpoint shots at the shore, `water-noon`, `water-golden-toward` and `-away` the setting Sun — the glow and the glitter path on one side, the plain horizon on the other — `water-overcast` and `water-night`; `WATER_RAW=1` adds `water-raw-golden`, three strips of the light times the Lambert term, the material's raw output and their product with the grade's haze and tint off, for reading pixel values against the material's maths), and a **shadow probe** at 18:15 (Sun ≈ 11°): a 20 m tower on flat ground seen from
above — and screenshots each. The shadow scene is measured, not just looked at: ground luminance
along the shadow line must be < 70 % of the Sun side, and the point just beyond `h / tan(el)` must
be as bright as the Sun side (direction, length and "no fade at low Sun" in one check). Any runtime exception, shader compile error or missing screenshot
fails the run. `docs/media/renderer-smoke-2026-09-24c.png` is the contact sheet from the run that
validated the layered cloud decks (SwiftShader software GL, so colours are exact but performance is not).

```sh
pnpm install
cd tools/renderer-smoke
pnpm exec tsc -p tsconfig.emit.json                      # emits packages → www/dist (ESM)
ln -s ../../../node_modules/cesium/Build/Cesium www/cesium-build   # the page's CESIUM_BASE_URL
node run.mjs
```

Without a package install, the CesiumJS release archive works as the build: unzip
`Build/Cesium` from `Cesium-1.146.zip` (GitHub releases) and link it as `www/cesium-build`. On
software GL a run takes several minutes; the runner allows fifteen, and each shot four.

The ground probe's material uniforms and its per-frame frame are the host's own
(`groundMaterialUniforms`, `anchorGroundFrame`, `updateGroundOffsets` from
`@lightmap/renderer/cesium`), so the probe draws what the globe draws; it had drifted from the
host and stopped before drawing. `docs/media/renderer-smoke-2026-10-19.png` is the contact sheet of
the last full run (CesiumJS 1.146, SwiftShader): fifteen shots, no errors, the globe program
compiled and linked, the shadow probe and the terrain horizon passing.

`www/index.html` uses an import map so the emitted packages and Cesium load as native ES modules;
nothing is bundled. The `cesium` meta-package is a **devDependency only**, used for its prebuilt
`Build/Cesium` bundle here; application code imports `@cesium/engine` (ADR-0002).

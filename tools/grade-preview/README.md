# Grade preview

Runs LightMap's real grade shader (`packages/renderer/src/shaders/grade.frag.ts`) on synthetic
frames in headless Chromium and saves what it does: one PNG per scene, beside the frame it was
given. No Cesium and no build: a sky gradient, a star field of Tycho-sized points, a Milky Way
band, a Moon or a Sun and a ridge with depth stand in for what Cesium hands the post-process
stage, and Cesium's automatic uniforms are stubbed (a real perspective projection, so the
shader's angles are right).

It is for judging the grade's sky by eye — the stars coming out through the twilight, the
planets, the Moon's aureole through haze and cirrus, the Milky Way at astronomical night, the
setting Sun's colour — without a GPU or a full renderer run. `tools/renderer-smoke` is the full
check against real CesiumJS.

```sh
pnpm install                                            # for playwright
pnpm exec playwright install chromium                   # unless CHROMIUM_PATH is set
node --experimental-strip-types tools/grade-preview/run.mjs          # every scene
node --experimental-strip-types tools/grade-preview/run.mjs sunset-sun-1deg
```

Output goes to `tools/grade-preview/out/` (git-ignored). `CHROMIUM_PATH` picks a browser binary;
otherwise playwright's own. It runs on SwiftShader (software GL) here, so colours are exact and
speed is not. Scenes are defined at the top of `run.mjs`: the Sun's elevation, the night factor,
haze, high cloud, the planets' places and points, the Moon's place and glow.

What the synthetic frame does not model: Cesium's real dome (a Moon-lit dome is a flat blue
gradient here, `moonlit-quarter`), the Moon's phase and earthshine (the disc is always full), and
the star cube's own texels (the stars are drawn points of about Tycho's size at this lens).
Findings about those need `tools/renderer-smoke` or the app.

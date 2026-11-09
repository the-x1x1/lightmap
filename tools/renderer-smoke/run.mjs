/**
 * Renderer smoke test: loads the real SceneController + CesiumSceneHost + grade shader in headless
 * Chromium against a bundled Cesium build, applies seven scenes (noon clear/overcast, golden hour,
 * blue hour, partly cloudy, moonlit night, storm, cirrus and stratus decks after sunset from a
 * forecast frame, a tower's shadow at low Sun, the ground texture on a probe with a synthetic cover
 * map and, close up, the detail atlas) and screenshots each; the shadow scene is also
 * measured (direction, length, no low-Sun fade). Fails on any runtime or
 * shader error. Usage (after `pnpm install`):
 *
 *   node --experimental-strip-types ../../node_modules/typescript/bin/tsc -p tsconfig.emit.json
 *   ln -s ../../../node_modules/cesium/Build/Cesium www/cesium-build   # bundled ESM build + Workers/Assets
 *   node run.mjs
 *
 * Output: shot-*.png and result.json in this directory; docs/media/renderer-smoke-*.png is a contact
 * sheet from one run. This is a manual/CI-optional gate because it needs a GPU or SwiftShader.
 */
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

// The app's ground detail atlas, served beside the page so the probe can take it as the host does.
mkdirSync(fileURLToPath(new URL('./www/textures', import.meta.url)), { recursive: true });
copyFileSync(
  fileURLToPath(new URL('../../apps/web/public/textures/ground-detail.png', import.meta.url)),
  fileURLToPath(new URL('./www/textures/ground-detail.png', import.meta.url)),
);
// One run at a time: a second run on the same port would load the first's page server and both
// would write the same shot files.
const portFree = await new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.listen(8765, '127.0.0.1', () => probe.close(() => resolve(true)));
});
if (!portFree) {
  console.error('Another smoke run holds port 8765: wait for it, or stop it, first.');
  process.exit(2);
}
const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], {
  cwd: fileURLToPath(new URL('./www', import.meta.url)),
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const consoleLines = [];
page.on('console', (m) => {
  const t = m.text();
  if (!t.startsWith('[smoke]')) consoleLines.push(`${m.type()}: ${t.slice(0, 300)}`);
});
page.on('pageerror', (e) => consoleLines.push('pageerror: ' + e.message));
if (process.env.SMOKE_ONLY === 'synthetic')
  await page.addInitScript(() => {
    window.__synthOnly = true;
  });
if (process.env.SMOKE_DEBUG === 'water')
  await page.addInitScript(() => {
    window.__synthDebug = true;
  });
if (process.env.WATER_RAW)
  await page.addInitScript((hour) => {
    window.__waterRaw = Number(hour) || 18.75;
  }, process.env.WATER_RAW);
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load', timeout: 120000 });
const shots = {};
const start = Date.now();
// Thirty minutes: on SwiftShader the synthetic terrain's tiles alone take minutes to settle.
const capMs = Number(process.env.SMOKE_MINUTES || 30) * 60_000;
let finished = false;
while (Date.now() - start < capMs) {
  const state = await page.evaluate(() => ({
    done: window.__smoke.done,
    shot: window.__smoke.shot,
  }));
  if (state.shot && !shots[state.shot]) {
    await page.screenshot({ path: `shot-${state.shot}.png`, timeout: 240000 });
    shots[state.shot] = true;
    await page.evaluate(() => {
      window.__smoke.shot = null;
      if (window.__takeShot) window.__takeShot();
    });
  }
  if (state.done) {
    finished = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 300));
}
// A run cut off by the cap is not a clean run, whatever errors the page had logged so far.
if (!finished) console.log(`SMOKE RUN CUT OFF after ${Math.round(capMs / 60_000)} min`);
const smoke = await page.evaluate(() => JSON.parse(JSON.stringify(window.__smoke)));
writeFileSync('result.json', JSON.stringify({ smoke, consoleLines, finished }, null, 2));
console.log(
  JSON.stringify(
    { steps: smoke.steps, errors: smoke.errors, stats: smoke.stats, shots: Object.keys(shots) },
    null,
    2,
  ),
);
await browser.close();
server.kill();
// Shadow probe: the tower's shadow must be clearly darker than the Sun side and must end where
// h / tan(el) says it ends (the point beyond it is as bright as the Sun side).
const probe = smoke.shadowProbe;
const complete = (xs) => xs.every((v) => typeof v === 'number');
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
let shadowOk = false;
if (
  probe &&
  probe.lum &&
  complete(probe.lum.inShadow) &&
  complete(probe.lum.sunSide) &&
  complete(probe.lum.beyond)
) {
  const inShadow = mean(probe.lum.inShadow);
  const sunSide = mean(probe.lum.sunSide);
  const beyond = mean(probe.lum.beyond);
  shadowOk =
    Number.isFinite(inShadow) &&
    Number.isFinite(sunSide) &&
    inShadow < 0.7 * sunSide &&
    Math.abs(beyond - sunSide) < 0.08;
  console.log(
    `shadow probe: el ${probe.el.toFixed(1)}°, length ${probe.lengthM.toFixed(0)} m, ` +
      `in-shadow ${inShadow.toFixed(2)} vs sun-side ${sunSide.toFixed(2)}, beyond ${beyond.toFixed(2)} → ${shadowOk ? 'ok' : 'FAIL'}`,
  );
} else console.log('shadow probe: missing or a probe point was off-screen → FAIL');
// Terrain horizon: at 07:00 the sun must be behind the synthetic eastern ridge, and first light
// over it must come after astronomical sunrise.
const terrain = smoke.terrain;
const terrainOk =
  !!terrain &&
  terrain.sunAboveTerrain === false &&
  terrain.differs === true &&
  terrain.firstLight !== null &&
  new Date(terrain.firstLight).getTime() > new Date(terrain.sunrise).getTime() + 30 * 60_000;
console.log(`terrain horizon: ${terrainOk ? 'ok' : 'FAIL'} ${JSON.stringify(terrain)}`);
process.exit(
  smoke.errors.length === 0 && Object.keys(shots).length >= 13 && shadowOk && terrainOk ? 0 : 1,
);

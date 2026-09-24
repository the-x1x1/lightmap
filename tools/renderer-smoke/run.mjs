/**
 * Renderer smoke test: loads the real SceneController + CesiumSceneHost + grade shader in headless
 * Chromium against a bundled Cesium build, applies seven scenes (noon clear/overcast, golden hour,
 * blue hour, partly cloudy, moonlit night, storm, cirrus and stratus decks after sunset from a
 * forecast frame, a tower's shadow at low Sun) and screenshots each; the shadow scene is also
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
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], {
  cwd: new URL('./www', import.meta.url).pathname,
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
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load', timeout: 120000 });
const shots = {};
const start = Date.now();
while (Date.now() - start < 180000) {
  const state = await page.evaluate(() => ({
    done: window.__smoke.done,
    shot: window.__smoke.shot,
  }));
  if (state.shot && !shots[state.shot]) {
    await page.screenshot({ path: `shot-${state.shot}.png` });
    shots[state.shot] = true;
    await page.evaluate(() => {
      window.__smoke.shot = null;
      if (window.__takeShot) window.__takeShot();
    });
  }
  if (state.done) break;
  await new Promise((r) => setTimeout(r, 300));
}
const smoke = await page.evaluate(() => JSON.parse(JSON.stringify(window.__smoke)));
writeFileSync('result.json', JSON.stringify({ smoke, consoleLines }, null, 2));
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
const mean = (xs) => xs.filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0) / xs.length;
let shadowOk = false;
if (probe && probe.lum) {
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
} else console.log('shadow probe: missing → FAIL');
process.exit(smoke.errors.length === 0 && Object.keys(shots).length >= 10 && shadowOk ? 0 : 1);

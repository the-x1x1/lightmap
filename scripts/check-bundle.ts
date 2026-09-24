/** Bundle gate (plan §27): the home route's first-load JS must stay under budget; Cesium must be a separate lazy chunk. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET_KB = 350; // first-load JS for "/" excluding the lazily loaded Cesium chunk
const buildDir = 'apps/web/.next';
if (!existsSync(buildDir)) {
  console.log('check-bundle: no build found, skipping');
  process.exit(0);
}
const manifestPath = join(buildDir, 'app-build-manifest.json');
if (!existsSync(manifestPath)) {
  console.log('check-bundle: app-build-manifest.json missing (Turbopack?), skipping');
  process.exit(0);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { pages: Record<string, string[]> };
const files = new Set<string>([...(manifest.pages['/page'] ?? []), ...(manifest.pages['/layout'] ?? [])]);
let total = 0;
let cesiumInFirstLoad = false;
for (const f of files) {
  if (!f.endsWith('.js')) continue;
  const p = join(buildDir, f);
  if (!existsSync(p)) continue;
  total += statSync(p).size;
  if (/cesium/i.test(readFileSync(p, 'utf8').slice(0, 200_000)) && statSync(p).size > 500_000) cesiumInFirstLoad = true;
}
const kb = Math.round(total / 1024);
console.log(`check-bundle: first-load JS for / = ${kb} KB (budget ${BUDGET_KB} KB)`);
const chunks = readdirSync(join(buildDir, 'static', 'chunks')).filter((f) => f.endsWith('.js'));
const big = chunks.map((f) => ({ f, size: statSync(join(buildDir, 'static', 'chunks', f)).size })).sort((a, b) => b.size - a.size).slice(0, 5);
for (const b of big) console.log(`  chunk ${b.f}: ${Math.round(b.size / 1024)} KB`);
if (kb > BUDGET_KB || cesiumInFirstLoad) {
  console.error(cesiumInFirstLoad ? 'Cesium is in the first-load bundle; it must be lazy-loaded.' : 'first-load JS over budget');
  process.exit(1);
}

/**
 * Copy Cesium's static runtime assets (Workers, ThirdParty wasm, Assets) from @cesium/engine into
 * public/cesium so `window.CESIUM_BASE_URL = '/cesium'` resolves. Runs before dev/build. Idempotent.
 */
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let enginePkg: string;
try {
  enginePkg = dirname(require.resolve('@cesium/engine/package.json'));
} catch {
  console.warn('[cesium-assets] @cesium/engine not installed; skipping');
  process.exit(0);
}
const target = join(here, '..', 'public', 'cesium');
const pairs: Array<[string, string]> = [
  [join(enginePkg, 'Build', 'Workers'), join(target, 'Workers')],
  [join(enginePkg, 'Build', 'ThirdParty'), join(target, 'ThirdParty')],
  [join(enginePkg, 'Source', 'Assets'), join(target, 'Assets')],
];
mkdirSync(target, { recursive: true });
for (const [from, to] of pairs) {
  if (!existsSync(from)) {
    console.warn(`[cesium-assets] missing ${from}`);
    continue;
  }
  if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue;
  cpSync(from, to, { recursive: true });
  console.log(`[cesium-assets] copied ${from} → ${to}`);
}
writeFileSync(
  join(target, 'VERSION'),
  `${JSON.parse(String(require('node:fs').readFileSync(join(enginePkg, 'package.json')))).version}\n`,
);

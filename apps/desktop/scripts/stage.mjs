#!/usr/bin/env node
/**
 * Assemble the folder the Windows installer packs (apps/desktop/stage by default), or, with
 * `--target mac`, the Resources folder of LightMap.app (apps/desktop/mac/build-app.sh):
 *
 *   LightMap.exe (+ the shell's other published files)   the desktop shell
 *   runtime/node.exe, runtime/LICENSE                       the Node runtime that runs the server
 *   server/apps/web/server.js, .next/, public/              Next's standalone output + static files
 *   server/node_modules/...                                 the server's traced dependencies
 *
 * Run after `pnpm --filter @lightmap/web build` with LIGHTMAP_DESKTOP=1 (standalone output) and
 * `dotnet publish` of LightMap.Desktop:
 *
 *   node apps/desktop/scripts/stage.mjs --node <node.exe> --shell <publish dir> [--out <dir>]
 *
 * Symlinks are copied as the files they point to: an installer cannot carry links, and pnpm's
 * workspace links would otherwise point outside the package.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const web = join(repo, 'apps', 'web');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return resolve(process.argv[i + 1]);
  if (fallback !== undefined) return fallback;
  console.error(`stage: --${name} is required`);
  process.exit(2);
}

function fail(message) {
  // In GitHub Actions an ::error:: line becomes an annotation, readable without the log.
  console.error(`${process.env.GITHUB_ACTIONS ? '::error::' : ''}stage: ${message}`);
  process.exit(1);
}

process.on('uncaughtException', (error) =>
  fail(error instanceof Error ? error.message : String(error)),
);

/**
 * Copy a tree, following every link (fs.cpSync's `dereference` only follows the top one).
 * A link that leads nowhere (Next keeps links to packages it did not trace) is left out and
 * reported; the self-test that follows staging is what proves the server has what it needs.
 */
const skipped = [];
function copyTree(src, dst) {
  let s;
  try {
    s = statSync(src);
  } catch {
    skipped.push(src);
    return;
  }
  if (s.isDirectory()) {
    mkdirSync(dst, { recursive: true });
    for (const name of readdirSync(src)) copyTree(join(src, name), join(dst, name));
  } else {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
}

const targetIndex = process.argv.indexOf('--target');
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : 'windows';
if (target !== 'windows' && target !== 'mac') fail(`unknown --target ${target}`);
const mac = target === 'mac';
const nodeExe = arg('node');
// The Mac shell is compiled into the bundle by build-app.sh; only Windows copies one in here.
const shellDir = mac ? null : arg('shell');
const out = arg('out', join(repo, 'apps', 'desktop', 'stage'));

const standalone = join(web, '.next', 'standalone');
if (!existsSync(join(standalone, 'apps', 'web', 'server.js')))
  fail(
    `${standalone}\\apps\\web\\server.js is missing: build the web app with LIGHTMAP_DESKTOP=1 first`,
  );
if (!existsSync(nodeExe)) fail(`no node runtime at ${nodeExe}`);
if (shellDir && !existsSync(join(shellDir, 'LightMap.exe'))) fail(`no LightMap.exe in ${shellDir}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. The server: Next's standalone tree, then what it leaves out on purpose (static assets).
const server = join(out, 'server');
copyTree(standalone, server);
const serverWeb = join(server, 'apps', 'web');
copyTree(join(web, '.next', 'static'), join(serverWeb, '.next', 'static'));
copyTree(join(web, 'public'), join(serverWeb, 'public'));

// Next copies .env files into the standalone tree; settings come from the shell and lightmap.env.
for (const dir of [server, serverWeb]) {
  for (const name of readdirSync(dir)) {
    if (name === '.env' || name.startsWith('.env.')) rmSync(join(dir, name), { force: true });
  }
}

// 2. geo-tz opens its boundary data by a computed path, which file tracing cannot see.
const requireFromWeb = createRequire(join(web, 'package.json'));
// geo-tz's exports map does not export package.json; its main entry is dist/<file>.js.
const geoTzSource = dirname(dirname(requireFromWeb.resolve('geo-tz')));
const geoTzTarget = join(server, 'node_modules', 'geo-tz');
if (!existsSync(geoTzTarget)) fail('geo-tz is not in the standalone node_modules');
copyTree(join(geoTzSource, 'data'), join(geoTzTarget, 'data'));

// 3. Cesium's runtime assets are copied into public/ by the web prebuild.
if (!existsSync(join(serverWeb, 'public', 'cesium', 'VERSION')))
  fail('public/cesium is missing: the web prebuild did not copy the Cesium assets');

// 4. The runtime.
const runtime = join(out, 'runtime');
mkdirSync(runtime, { recursive: true });
const runtimeNode = join(runtime, mac ? 'node' : 'node.exe');
copyFileSync(nodeExe, runtimeNode);
if (mac) chmodSync(runtimeNode, 0o755);
const nodeLicense = join(dirname(nodeExe), 'LICENSE');
if (existsSync(nodeLicense)) copyFileSync(nodeLicense, join(runtime, 'LICENSE'));

// 5. The shell (Windows).
if (shellDir) copyTree(shellDir, out);

// 6. Say what went in.
let files = 0;
let bytes = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else {
      files++;
      bytes += s.size;
    }
  }
})(out);
for (const p of skipped) console.warn(`stage: left out ${p} (a link to nothing)`);
console.log(`stage: ${out}: ${files} files, ${(bytes / 1048576).toFixed(1)} MiB`);

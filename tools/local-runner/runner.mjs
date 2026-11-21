#!/usr/bin/env node
/**
 * LightMap local runner: tests a stack of commits on the owner's own machine before it is pushed.
 *
 * It watches a patch (`git format-patch --stdout base..HEAD`) and, each time the patch changes:
 *
 *   1. applies it to a scratch clone of the local repository (never to that repository itself,
 *      and never to a remote), and checks that every commit's tree is the one the patch's
 *      description says it should be;
 *   2. builds the newest commit as the desktop app is built and serves it on this machine only
 *      (http://127.0.0.1:47700), with the renderer smoke page beside it
 *      (http://127.0.0.1:47701), so both can be opened on a real GPU;
 *   3. runs CI's checks on every commit of the stack - format, lint, typecheck, unit tests - the
 *      newest first, and on the newest also the full build and the rest of CI's validate job.
 *
 * Status and logs are written beside this file (status.json, results.json, logs/). Nothing is
 * pushed, nothing outside the work folder and this folder is written, and both servers listen on
 * the loopback address only. See README.md.
 *
 * No dependencies: Node 22 and git on the PATH, and pnpm (or corepack) for the repository's own.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNNER_VERSION = 3;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === 'win32';
const E = process.env;

export const CFG = {
  dir: HERE,
  patch: E.LM_PATCH ?? path.join(HERE, '..', 'lightmap-stack.patch'),
  meta: E.LM_META ?? path.join(HERE, '..', 'lightmap-stack.json'),
  source: E.LM_SOURCE ?? path.join(os.homedir(), 'lightmap-push'),
  work: E.LM_WORK ?? path.join(os.homedir(), 'lightmap-runner-work'),
  appPort: Number(E.LM_APP_PORT ?? 47700),
  harnessPort: Number(E.LM_HARNESS_PORT ?? 47701),
  /** The desktop app's optional settings (map keys and the like), passed to the served build. */
  envFile:
    E.LM_ENV_FILE ??
    (E.LOCALAPPDATA ? path.join(E.LOCALAPPDATA, 'LightMap', 'lightmap.env') : null),
  pollMs: Number(E.LM_POLL_MS ?? 5000),
  /** Stop after one pass over the stack (tests). */
  once: E.LM_ONCE === '1',
};

const SERVE = path.join(CFG.work, 'serve');
const CHECK = path.join(CFG.work, 'check');
const STAGE = path.join(CFG.work, 'stage');
const LOGS = path.join(CFG.dir, 'logs');
const STATUS = path.join(CFG.dir, 'status.json');
const RESULTS = path.join(CFG.dir, 'results.json');
const INBOX = path.join(CFG.dir, 'inbox');

// --- small things ------------------------------------------------------------------------------
const now = () => new Date().toISOString();
const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};
const sha256 = (p) => {
  try {
    return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch {
    return null;
  }
};
const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
/** Written whole or not at all: a reader never sees half a file. */
function writeJson(p, value) {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, p);
      return;
    } catch (error) {
      // Windows refuses the rename while a reader has the file open: try again shortly.
      if (i >= 20) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
function say(line) {
  const text = `${now()} ${line}`;
  console.log(text);
  try {
    fs.appendFileSync(path.join(CFG.dir, 'runner.log'), text + '\n');
  } catch {
    // The log is a convenience.
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = (text, lines = 30) => String(text).trimEnd().split(/\r?\n/).slice(-lines).join('\n');

// --- status ------------------------------------------------------------------------------------
const status = {
  runner: {
    version: RUNNER_VERSION,
    pid: process.pid,
    startedAt: now(),
    node: process.version,
    platform: `${process.platform} ${os.release()}`,
    cpus: os.cpus().length,
  },
  state: 'starting',
  message: '',
  stack: null,
  serving: null,
  harness: null,
  checks: { total: 0, done: 0, failing: [] },
  error: null,
  updatedAt: now(),
};
function setStatus(patch) {
  Object.assign(status, patch, { updatedAt: now() });
  try {
    writeJson(STATUS, status);
  } catch (error) {
    console.error('status.json: ' + error.message);
  }
}

// --- processes ---------------------------------------------------------------------------------
/** An argument as cmd.exe and the C runtime both read it. */
const winQuote = (a) => (/^[A-Za-z0-9_\-./:=\\@+,]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);

const children = new Set();
function killTree(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try {
    if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/**
 * Runs a command to its end, its output to `log`. `argv[0]` may be a .cmd shim (pnpm, corepack),
 * so on Windows the line goes through cmd.exe. Resolves with the exit code (-1: could not start,
 * -2: timed out).
 */
export function run(argv, { cwd, env, log, header = true, timeoutMs = 20 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = null;
    if (log) {
      fs.mkdirSync(path.dirname(log), { recursive: true });
      out = fs.openSync(log, 'w');
      if (header) fs.writeSync(out, `$ ${argv.join(' ')}\n  in ${cwd}\n\n`);
    }
    const stdio = ['ignore', out ?? 'ignore', out ?? 'ignore'];
    const options = {
      cwd,
      // corepack must not stop to ask before it fetches the pnpm the repository names.
      // And the logs are read as text: no colour codes in them.
      env: { ...E, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', NO_COLOR: '1', FORCE_COLOR: '0', ...env },
      stdio,
      windowsHide: true,
      detached: !WIN,
    };
    let child;
    try {
      child = WIN
        ? spawn(E.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${argv.map(winQuote).join(' ')}"`], {
            ...options,
            windowsVerbatimArguments: true,
          })
        : spawn(argv[0], argv.slice(1), options);
    } catch (error) {
      if (out !== null) fs.closeSync(out);
      resolve({ code: -1, ms: 0, error: error.message });
      return;
    }
    children.add(child);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const done = (code, error) => {
      clearTimeout(timer);
      children.delete(child);
      if (out !== null) {
        try {
          if (timedOut) fs.writeSync(out, `\n[runner] stopped after ${timeoutMs / 1000} s\n`);
          fs.closeSync(out);
        } catch {
          // Closed already.
        }
        out = null;
      }
      resolve({ code: timedOut ? -2 : (code ?? -1), ms: Date.now() - started, error });
    };
    child.once('error', (error) => done(-1, error.message));
    child.once('exit', (code) => done(code));
  });
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}
function mustGit(cwd, ...args) {
  const r = git(cwd, ...args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${tail(r.out, 12)}`);
  return r.out;
}

let pnpmArgv = null;
/** pnpm as this machine has it: its own shim, or through corepack (which Node ships). */
async function findPnpm() {
  if (pnpmArgv) return pnpmArgv;
  for (const candidate of [E.LM_PNPM ? [E.LM_PNPM] : null, ['pnpm'], ['corepack', 'pnpm']]) {
    if (!candidate) continue;
    const r = await run([...candidate, '--version'], { cwd: CFG.dir, timeoutMs: 120_000 });
    if (r.code === 0) {
      pnpmArgv = candidate;
      return candidate;
    }
  }
  throw new Error(
    'pnpm was not found. Install it with "corepack enable" (Node ships corepack) or "npm install -g pnpm", then start the runner again.',
  );
}

// --- the stack ---------------------------------------------------------------------------------
/** The clone the stack is applied to. */
function ensureServe() {
  fs.mkdirSync(CFG.work, { recursive: true });
  if (exists(path.join(SERVE, '.git'))) return;
  if (!exists(path.join(CFG.source, '.git')))
    throw new Error(`no git repository at ${CFG.source} (set LM_SOURCE to the local clone)`);
  say(`cloning ${CFG.source}`);
  mustGit(CFG.work, 'clone', '--quiet', '--no-checkout', CFG.source, SERVE);
  // The files as CI has them, whatever this machine's git prefers: LF line ends (Prettier
  // reads CRLF as a formatting fault in every file) and long paths.
  for (const [k, v] of [
    ['core.autocrlf', 'false'],
    ['core.eol', 'lf'],
    ['core.longpaths', 'true'],
    ['advice.detachedHead', 'false'],
    ['user.name', 'lightmap-runner'],
    ['user.email', 'runner@localhost'],
    ['gc.auto', '0'],
  ])
    mustGit(SERVE, 'config', k, v);
}

/** A second work tree of the clone, for the per-commit checks. */
function ensureCheck(base) {
  if (exists(path.join(CHECK, '.git'))) return;
  git(SERVE, 'worktree', 'prune');
  mustGit(SERVE, 'worktree', 'add', '--quiet', '--detach', '--force', CHECK, base);
}

/** Removes a link (a junction on Windows) without following it. */
function unlinkLink(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) {
    try {
      fs.unlinkSync(p);
    } catch {
      fs.rmdirSync(p);
    }
  }
}

/**
 * Applies the patch on its base in the serving clone. Returns the commits, oldest first, each
 * with its tree; throws with git's own words when the patch does not apply.
 */
function applyStack(meta) {
  ensureServe();
  git(SERVE, 'fetch', '--quiet', 'origin');
  const base = meta?.base ?? mustGit(SERVE, 'rev-parse', 'origin/HEAD');
  if (git(SERVE, 'cat-file', '-e', `${base}^{commit}`).code !== 0)
    throw new Error(
      `the stack's base ${base.slice(0, 10)} is not in ${CFG.source}: fetch there (git fetch origin) and the runner will try again`,
    );
  ensureCheck(base);
  git(SERVE, 'am', '--abort');
  // The smoke page's link to Cesium's build is put back after the build; it is taken away
  // first so that nothing git does here can follow it into node_modules.
  unlinkLink(path.join(SERVE, 'tools', 'renderer-smoke', 'www', 'cesium-build'));
  mustGit(SERVE, 'checkout', '--quiet', '--force', '--detach', base);
  mustGit(SERVE, 'clean', '-fd', '--quiet');
  if (fs.statSync(CFG.patch).size > 0) {
    const am = git(SERVE, 'am', '--quiet', '--committer-date-is-author-date', CFG.patch);
    if (am.code !== 0) {
      git(SERVE, 'am', '--abort');
      throw new Error(`the patch does not apply on ${base.slice(0, 7)}: ${tail(am.out, 12)}`);
    }
  }
  const log = mustGit(SERVE, 'log', '--reverse', '--format=%H %T %s', `${base}..HEAD`);
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      const [sha, tree, ...subject] = line.split(' ');
      return { n: i + 1, sha, tree, subject: subject.join(' ') };
    });
  // The description that came with the patch: every commit's tree must be the sender's.
  const problems = [];
  if (meta?.commits) {
    if (meta.commits.length !== commits.length)
      problems.push(`${commits.length} commits applied, ${meta.commits.length} described`);
    meta.commits.forEach((want, i) => {
      const got = commits[i];
      if (got && want.tree && got.tree !== want.tree)
        problems.push(
          `commit ${i + 1} (${got.subject}): tree ${got.tree.slice(0, 10)}, described ${want.tree.slice(0, 10)}`,
        );
      if (got && want.sha) got.sender = want.sha;
    });
  }
  return { base, commits, problems };
}

// --- installs ----------------------------------------------------------------------------------
/** `pnpm install` where the lockfile is not the one this tree was last installed from. */
async function install(dir, name, extra = []) {
  const lock = sha256(path.join(dir, 'pnpm-lock.yaml'));
  const marker = path.join(dir, 'node_modules', '.lm-installed');
  const key = `${lock} ${extra.join(' ')}`;
  if (exists(marker) && fs.readFileSync(marker, 'utf8') === key)
    return { code: 0, ms: 0, skipped: true };
  const pnpm = await findPnpm();
  const r = await run([...pnpm, 'install', '--frozen-lockfile', '--prefer-offline', ...extra], {
    cwd: dir,
    env: { CI: 'true' },
    log: path.join(LOGS, `${name}-install.log`),
    timeoutMs: 30 * 60_000,
  });
  if (r.code === 0) fs.writeFileSync(marker, key);
  return r;
}

// --- the served build --------------------------------------------------------------------------
let server = null;
const SERVER_PID = path.join(CFG.work, 'server.pid');
function stopServer() {
  if (server) {
    killTree(server);
    fs.rmSync(SERVER_PID, { force: true });
  }
  server = null;
  killStaleServer();
}

/**
 * A server an earlier runner left behind (its window was closed hard) still holds the port, and
 * a health check would be answered by that old build. Its pid was written down: if that process
 * is still a node, it is stopped.
 */
function killStaleServer() {
  let pid;
  try {
    pid = Number(fs.readFileSync(SERVER_PID, 'utf8'));
    fs.rmSync(SERVER_PID, { force: true });
  } catch {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  try {
    if (WIN) {
      const list = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (!/^"node\.exe"/im.test(list.stdout ?? '')) return;
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      const comm = spawnSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' });
      if (!/node/.test(comm.stdout ?? '')) return;
      process.kill(pid, 'SIGKILL');
    }
    say(`stopped a server left by an earlier run (pid ${pid})`);
  } catch {
    // Gone already.
  }
}

/** KEY=VALUE lines of the desktop app's own settings file; values are never logged. */
function desktopEnv() {
  const out = {};
  if (!CFG.envFile) return out;
  let text;
  try {
    text = fs.readFileSync(CFG.envFile, 'utf8');
  } catch {
    return out;
  }
  const reserved = new Set([
    'PORT',
    'HOSTNAME',
    'NEXT_PUBLIC_APP_URL',
    'LIGHTMAP_DATA_DIR',
    'LIGHTMAP_DESKTOP_SECRET',
  ]);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || reserved.has(key.toUpperCase())) continue;
    out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

function httpGet(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ status: 0, body: error.message }));
  });
}

/** Builds HEAD as the desktop app is built, stages its server and starts it. */
async function buildAndServe(head) {
  const pnpm = await findPnpm();
  const steps = [];
  const step = async (name, fn) => {
    setStatus({ state: 'building', message: `${name} (${head.subject})` });
    const r = await fn();
    steps.push({ name, ok: r.code === 0, code: r.code, ms: r.ms, log: r.log ?? null });
    if (r.code !== 0) throw Object.assign(new Error(`${name} failed (exit ${r.code})`), { steps });
  };
  const log = (name) => path.join(LOGS, `serve-${name}.log`);
  const serverJs = path.join(STAGE, 'server', 'apps', 'web', 'server.js');
  const stagedFile = path.join(CFG.work, 'staged.json');
  // The very tree staged last time (the runner was started again): only the server to start.
  const fresh = readJson(stagedFile, null)?.tree === head.tree && exists(serverJs);
  if (!fresh) await buildAndStage(head, pnpm, step, log, stagedFile);
  else stopServer();
  return startServer(serverJs, log, steps);
}

async function buildAndStage(head, pnpm, step, log, stagedFile) {
  fs.rmSync(stagedFile, { force: true });
  await step('install', async () => ({
    ...(await install(SERVE, 'serve', ['--config.node-linker=hoisted'])),
    log: 'logs/serve-install.log',
  }));
  await step('build', async () => ({
    ...(await run([...pnpm, '--filter', '@lightmap/web', 'build'], {
      cwd: SERVE,
      env: { LIGHTMAP_DESKTOP: '1', NEXT_TELEMETRY_DISABLED: '1', CI: 'true' },
      log: log('build'),
      timeoutMs: 30 * 60_000,
    })),
    log: 'logs/serve-build.log',
  }));
  stopServer();
  await step('stage', async () => ({
    ...(await run(
      [
        process.execPath,
        path.join('apps', 'desktop', 'scripts', 'stage.mjs'),
        '--target',
        'server',
        '--out',
        STAGE,
      ],
      { cwd: SERVE, log: log('stage'), timeoutMs: 10 * 60_000 },
    )),
    log: 'logs/serve-stage.log',
  }));
  writeJson(stagedFile, { tree: head.tree, at: now() });
}

async function startServer(serverJs, log, steps) {
  const url = `http://127.0.0.1:${CFG.appPort}`;
  const dataDir = path.join(CFG.work, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const out = fs.openSync(log('server'), 'w');
  server = spawn(process.execPath, [serverJs], {
    cwd: path.dirname(serverJs),
    env: {
      ...E,
      ...desktopEnv(),
      NODE_ENV: 'production',
      LIGHTMAP_STANDALONE: 'true',
      LIGHTMAP_DESKTOP: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      PORT: String(CFG.appPort),
      HOSTNAME: '127.0.0.1',
      NEXT_PUBLIC_APP_URL: url,
      LIGHTMAP_DATA_DIR: dataDir,
    },
    stdio: ['ignore', out, out],
    windowsHide: true,
    detached: !WIN,
  });
  fs.closeSync(out);
  const mine = server;
  children.add(mine);
  if (mine.pid !== undefined) fs.writeFileSync(SERVER_PID, String(mine.pid));
  mine.once('exit', (code) => {
    children.delete(mine);
    if (server === mine) {
      server = null;
      say(`the app server stopped (exit ${code})`);
      setStatus({ serving: null });
    }
  });
  let health = null;
  for (let i = 0; i < 90 && server === mine; i++) {
    health = await httpGet(`${url}/api/health`);
    if (health.status === 200) break;
    await sleep(1000);
  }
  // Answered - and by the server started here: one that could not take the port has exited.
  if (server !== mine || health?.status !== 200) {
    let why = `${health?.status}: ${tail(health?.body, 3)}`;
    try {
      why = tail(fs.readFileSync(log('server'), 'utf8'), 8) || why;
    } catch {
      // The health answer says enough.
    }
    throw Object.assign(new Error(`the server did not come up on ${url}: ${why}`), { steps });
  }
  return { url, health: readJsonText(health.body), steps };
}
const readJsonText = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return String(text).slice(0, 200);
  }
};

// --- the renderer smoke page -------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
};
let harnessServer = null;
let harnessRoot = null;
let harnessOut = null;

/** Where a request's path lands under `root`, or null when it would leave it. */
/**
 * Whether a failed step's log shows only Node crashing on its way out on Windows - libuv's
 * `!(handle->flags & UV_HANDLE_CLOSING)` assertion in async.c, exit 0xC0000409 - after the step
 * itself had finished (seen once on the env check, which had printed OK). Such a step is run
 * once more before it is called a failure.
 */
export function crashedOnExit(logText) {
  return /Assertion failed: !\(handle->flags & UV_HANDLE_CLOSING\)/.test(logText);
}

export function safeJoin(root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  const full = path.resolve(root, '.' + path.posix.normalize('/' + rel.replace(/\\/g, '/')));
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

function startHarnessServer() {
  if (harnessServer) return;
  harnessServer = http.createServer((req, res) => {
    const send = (code, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    };
    if (!harnessRoot) return send(503, 'the smoke page is not built yet');
    // The page's own results (shots as PNG, the result as JSON), written beside the runner's
    // logs: named files only, from this machine only (the listener is on the loopback address,
    // and a page from elsewhere is refused by its Origin).
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${CFG.harnessPort}`) return send(403, 'refused');
      const m = /^\/__(shot|result)\/([A-Za-z0-9][A-Za-z0-9._-]{0,80})$/.exec(req.url ?? '');
      if (!m || !harnessOut) return send(404, 'no such place');
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 40 * 1024 * 1024) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        try {
          fs.mkdirSync(harnessOut, { recursive: true });
          const name = m[1] === 'shot' ? `shot-${m[2]}.png` : `${m[2]}.json`;
          fs.writeFileSync(path.join(harnessOut, name), Buffer.concat(chunks));
          send(200, 'ok');
        } catch (error) {
          send(500, error.message);
        }
      });
      return undefined;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'no');
    let file = safeJoin(harnessRoot, req.url === '/' ? '/index.html' : (req.url ?? '/'));
    if (!file) return send(400, 'bad path');
    fs.stat(file, (error, st) => {
      if (!error && st.isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (readError, data) => {
        if (readError) return send(404, 'not found');
        return send(
          200,
          req.method === 'HEAD' ? '' : data,
          MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        );
      });
    });
    return undefined;
  });
  harnessServer.on('error', (error) => say('smoke page server: ' + error.message));
  harnessServer.listen(CFG.harnessPort, '127.0.0.1');
}

/** Emits the packages for the smoke page and gives it Cesium's build and the detail atlas. */
async function buildHarness(head) {
  const pnpm = await findPnpm();
  const tool = path.join(SERVE, 'tools', 'renderer-smoke');
  const www = path.join(tool, 'www');
  if (!exists(path.join(www, 'index.html'))) return null;
  setStatus({ state: 'building', message: `the smoke page (${head.subject})` });
  fs.rmSync(path.join(www, 'dist'), { recursive: true, force: true });
  // tsc reports type errors the page does not care about (it has no @types): what counts is
  // that the files were emitted.
  const emit = await run(
    [...pnpm, 'exec', 'tsc', '-p', path.join('tools', 'renderer-smoke', 'tsconfig.emit.json')],
    {
      cwd: SERVE,
      log: path.join(LOGS, 'serve-harness.log'),
      timeoutMs: 10 * 60_000,
    },
  );
  const entry = path.join(www, 'dist', 'renderer', 'src', 'index.js');
  if (!exists(entry))
    return {
      ok: false,
      reason: `tsc emitted nothing (exit ${emit.code})`,
      log: 'logs/serve-harness.log',
    };
  const cesium = path.join(SERVE, 'node_modules', 'cesium', 'Build', 'Cesium');
  const link = path.join(www, 'cesium-build');
  if (!exists(path.join(link, 'index.js'))) {
    if (!exists(path.join(cesium, 'index.js')))
      return { ok: false, reason: `no Cesium build at ${cesium}` };
    unlinkLink(link);
    fs.symlinkSync(cesium, link, 'junction');
  }
  const atlas = path.join(SERVE, 'apps', 'web', 'public', 'textures', 'ground-detail.png');
  if (exists(atlas)) {
    fs.mkdirSync(path.join(www, 'textures'), { recursive: true });
    fs.copyFileSync(atlas, path.join(www, 'textures', 'ground-detail.png'));
  }
  harnessRoot = www;
  harnessOut = path.join(CFG.dir, 'harness', head.tree.slice(0, 10));
  startHarnessServer();
  return {
    ok: true,
    url: `http://127.0.0.1:${CFG.harnessPort}/index.html`,
    results: `harness/${head.tree.slice(0, 10)}`,
  };
}

// --- CI's checks, commit by commit -------------------------------------------------------------
const MIGRATIONS =
  "import('./packages/database/src/migrate.ts').then(async (m) => { const p = m.validateMigrationSet(await m.loadMigrations()); if (p.length) { console.error(p); process.exit(1); } console.log('migrations ok'); })";

/** CI's validate job (.github/workflows/ci.yml), in its order; the tail only for the newest. */
function checkSteps(pnpm, newest) {
  const every = [
    ['format', [...pnpm, 'format:check'], {}],
    ['lint', [...pnpm, 'lint'], {}],
    ['typecheck', [...pnpm, 'typecheck'], {}],
    ['unit', [...pnpm, 'test:unit'], {}],
  ];
  if (!newest) return every;
  const strip = [process.execPath, '--experimental-strip-types'];
  return [
    ['env', [...pnpm, 'env:validate'], { NODE_ENV: 'development' }],
    ...every,
    ['attribution', [...strip, path.join('scripts', 'check-attribution.ts')], {}],
    ['licenses', [...pnpm, 'licenses:check'], {}],
    ['secrets', [...pnpm, 'secrets:scan'], {}],
    ['migrations', [...strip, '-e', MIGRATIONS], {}],
    [
      'build',
      [...pnpm, 'build'],
      { NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' },
    ],
    ['bundle', [...strip, path.join('scripts', 'check-bundle.ts')], {}],
  ];
}

/**
 * What Prettier would write for each file it flagged, under formatted/<tree>/ (the path with
 * its separators doubled into underscores): the sender's Prettier may be another version, and
 * this is the one CI runs.
 */
async function writeFormatted(logFile, short) {
  let text;
  try {
    text = fs.readFileSync(logFile, 'utf8');
  } catch {
    return;
  }
  const colour = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
  const files = [...text.replace(colour, '').matchAll(/^\[warn\] (\S.*)$/gm)]
    .map((m) => m[1].trim())
    .filter((f) => !f.startsWith('Code style') && exists(path.join(CHECK, f)))
    .slice(0, 30);
  if (files.length === 0) return;
  const pnpm = await findPnpm();
  const dir = path.join(CFG.dir, 'formatted', short);
  for (const f of files)
    await run([...pnpm, 'exec', 'prettier', f], {
      cwd: CHECK,
      log: path.join(dir, f.replace(/[\\/]/g, '__')),
      header: false,
      timeoutMs: 120_000,
    });
}

async function checkCommit(commit, newest, total) {
  const pnpm = await findPnpm();
  const short = commit.tree.slice(0, 10);
  const result = {
    n: commit.n,
    sha: commit.sha,
    sender: commit.sender ?? null,
    tree: commit.tree,
    subject: commit.subject,
    newest,
    startedAt: now(),
    steps: [],
    ok: false,
  };
  mustGit(CHECK, 'checkout', '--quiet', '--force', '--detach', commit.sha);
  mustGit(CHECK, 'clean', '-fd', '--quiet');
  const inst = await install(CHECK, `check-${short}`);
  if (inst.code !== 0) {
    result.steps.push({
      name: 'install',
      ok: false,
      code: inst.code,
      ms: inst.ms,
      log: `logs/check-${short}-install.log`,
    });
    return result;
  }
  for (const [name, argv, env] of checkSteps(pnpm, newest)) {
    setStatus({ state: 'checking', message: `${commit.n}/${total} ${name}: ${commit.subject}` });
    const log = `logs/check-${short}-${name}.log`;
    const runStep = () =>
      run(argv, {
        cwd: CHECK,
        env: { CI: 'true', ...env },
        log: path.join(CFG.dir, log),
        timeoutMs: 30 * 60_000,
      });
    let r = await runStep();
    let retried = false;
    if (r.code !== 0) {
      let text = '';
      try {
        text = fs.readFileSync(path.join(CFG.dir, log), 'utf8');
      } catch {
        // No log: not the crash this looks for.
      }
      if (crashedOnExit(text)) {
        say(`${commit.n}/${total} ${name}: Node crashed on exit; running it once more`);
        retried = true;
        r = await runStep();
      }
    }
    const ok = r.code === 0;
    result.steps.push({ name, ok, code: r.code, ms: r.ms, log, ...(retried ? { retried } : {}) });
    // A passing log is noise; a failing one is what is wanted.
    if (ok) fs.rmSync(path.join(CFG.dir, log), { force: true });
    else
      try {
        fs.writeFileSync(
          path.join(CFG.dir, log + '.tail.txt'),
          tail(fs.readFileSync(path.join(CFG.dir, log), 'utf8'), 120),
        );
      } catch {
        // The whole log is still there.
      }
    if (!ok && name === 'format' && newest) await writeFormatted(path.join(CFG.dir, log), short);
    if (interrupted()) {
      result.interrupted = true;
      return result;
    }
  }
  result.ok = result.steps.every((s) => s.ok);
  result.finishedAt = now();
  return result;
}

// --- the loop ----------------------------------------------------------------------------------
const selfHash = sha256(fileURLToPath(import.meta.url));
let lastPatch = null;
let lastMeta = null;
const patchChanged = () => sha256(CFG.patch) !== lastPatch || sha256(CFG.meta) !== lastMeta;
const selfChanged = () => sha256(fileURLToPath(import.meta.url)) !== selfHash;
/** Named requests dropped in inbox/ as <name>.json: rebuild, recheck, stop. */
function takeRequests() {
  let names = [];
  try {
    names = fs.readdirSync(INBOX).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const body = readJson(path.join(INBOX, n), {});
    fs.rmSync(path.join(INBOX, n), { force: true });
    const cmd = String(body.cmd ?? n.replace(/\.json$/, ''));
    if (['rebuild', 'recheck', 'stop'].includes(cmd))
      out.push({ cmd, tree: typeof body.tree === 'string' ? body.tree : null });
  }
  return out;
}
let pending = [];
const interrupted = () => {
  pending.push(...takeRequests());
  return patchChanged() || selfChanged() || pending.length > 0;
};

function shutdown(code) {
  stopServer();
  for (const c of children) killTree(c);
  try {
    harnessServer?.close();
  } catch {
    // Closing anyway.
  }
  process.exit(code);
}

async function pass() {
  lastPatch = sha256(CFG.patch);
  lastMeta = sha256(CFG.meta);
  if (lastPatch === null) {
    setStatus({ state: 'waiting', message: `no patch at ${CFG.patch}`, error: null });
    return;
  }
  const meta = readJson(CFG.meta, null);
  setStatus({ state: 'syncing', message: 'applying the stack', error: null });
  const stack = applyStack(meta);
  const head = stack.commits[stack.commits.length - 1] ?? null;
  const results = readJson(RESULTS, { trees: {} });
  const describe = () => ({
    patchSha256: lastPatch,
    base: stack.base,
    commits: stack.commits.length,
    head: head
      ? {
          n: head.n,
          sha: head.sha,
          sender: head.sender ?? null,
          tree: head.tree,
          subject: head.subject,
        }
      : null,
    problems: stack.problems,
  });
  setStatus({ stack: describe() });
  say(
    `stack: ${stack.commits.length} commits on ${stack.base.slice(0, 7)}${stack.problems.length ? ` - ${stack.problems.length} PROBLEMS` : ''}`,
  );
  if (!head) {
    setStatus({ state: 'idle', message: 'the stack is empty' });
    return;
  }

  // The newest commit, built and served - unless that very tree is being served already.
  const force = pending.some((r) => r.cmd === 'rebuild');
  pending = pending.filter((r) => r.cmd !== 'rebuild');
  if (force || status.serving?.tree !== head.tree || !server) {
    try {
      const served = await buildAndServe(head);
      setStatus({
        serving: {
          url: served.url,
          tree: head.tree,
          sha: head.sha,
          sender: head.sender ?? null,
          subject: head.subject,
          health: served.health,
          steps: served.steps,
          at: now(),
        },
      });
      say(`serving ${head.subject} at ${served.url}`);
    } catch (error) {
      say(`serve: ${error.message}`);
      setStatus({
        serving: null,
        error: `serve: ${error.message}`,
        serveSteps: error.steps ?? null,
      });
    }
    try {
      setStatus({ harness: await buildHarness(head) });
    } catch (error) {
      setStatus({ harness: { ok: false, reason: error.message } });
    }
    if (interrupted()) return;
  }

  // CI's checks: the newest commit first, then the rest, newest to oldest.
  for (const r of pending.filter((q) => q.cmd === 'recheck')) {
    if (r.tree) delete results.trees[r.tree];
    else results.trees = {};
  }
  pending = pending.filter((r) => r.cmd !== 'recheck');
  const order = [...stack.commits].reverse();
  const summary = () => {
    const done = stack.commits.filter(
      (c) => results.trees[c.tree] && !results.trees[c.tree].interrupted,
    );
    return {
      total: stack.commits.length,
      done: done.length,
      failing: done
        .filter((c) => !results.trees[c.tree].ok)
        .map((c) => ({
          n: c.n,
          sender: c.sender ?? null,
          subject: c.subject,
          steps: results.trees[c.tree].steps.filter((s) => !s.ok).map((s) => s.name),
        })),
    };
  };
  setStatus({ checks: summary() });
  for (const commit of order) {
    const known = results.trees[commit.tree];
    const newest = commit === head;
    // A tree checked before is not checked again - but the newest gets CI's whole job once.
    if (known && !known.interrupted && (!newest || known.newest)) continue;
    const result = await checkCommit(commit, newest, stack.commits.length);
    results.trees[commit.tree] = result;
    writeJson(RESULTS, results);
    setStatus({ checks: summary() });
    say(
      `${result.interrupted ? 'interrupted' : result.ok ? 'ok  ' : 'FAIL'} ${commit.n}/${stack.commits.length} ${commit.subject}${
        result.ok || result.interrupted
          ? ''
          : ' [' +
            result.steps
              .filter((s) => !s.ok)
              .map((s) => s.name)
              .join(', ') +
            ']'
      }`,
    );
    if (result.interrupted || interrupted()) return;
  }
  const s = summary();
  setStatus({
    state: 'idle',
    message: s.failing.length
      ? `${s.failing.length} of ${s.total} commits fail a check`
      : `all ${s.total} commits pass`,
    checks: s,
  });
}

async function main() {
  fs.mkdirSync(LOGS, { recursive: true });
  fs.mkdirSync(INBOX, { recursive: true });
  say(`LightMap runner ${RUNNER_VERSION} - patch ${CFG.patch} - work ${CFG.work}`);
  setStatus({ state: 'starting', message: '' });
  // SIGHUP is what Windows sends when the console window is closed.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'])
    process.on(signal, () => shutdown(0));
  let first = true;
  for (;;) {
    pending.push(...takeRequests());
    if (pending.some((r) => r.cmd === 'stop')) {
      say('stop requested');
      setStatus({ state: 'stopped', message: 'stopped on request' });
      shutdown(0);
    }
    if (selfChanged()) {
      say('the runner itself changed: starting again');
      setStatus({ state: 'restarting', message: 'the runner was updated' });
      shutdown(42);
    }
    if (first || patchChanged() || pending.length > 0) {
      first = false;
      try {
        await pass();
      } catch (error) {
        say(`error: ${error.message}`);
        setStatus({ state: 'error', error: error.message, message: 'waiting for a new patch' });
      }
      if (CFG.once) shutdown(status.error || status.checks.failing.length ? 1 : 0);
    }
    await sleep(CFG.pollMs);
  }
}

/**
 * Started plainly, this file only keeps a worker running: the worker is this file again, read
 * afresh each time, so a runner.mjs replaced by a newer one takes over when the worker leaves
 * with code 42 - with no loop in the launcher's batch file.
 */
function supervise() {
  const self = fileURLToPath(import.meta.url);
  // The console's own signals reach the worker too, and it is the worker that tidies up.
  for (const signal of ['SIGINT', 'SIGBREAK', 'SIGHUP']) process.on(signal, () => undefined);
  const start = () => {
    const worker = spawn(process.execPath, [self, '--worker'], { stdio: 'inherit' });
    worker.once('error', (error) => {
      console.error('runner: ' + error.message);
      process.exit(1);
    });
    worker.once('exit', (code) => {
      if (code === 42) start();
      else process.exit(code ?? 1);
    });
  };
  start();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--worker') || CFG.once) await main();
  else supervise();
}

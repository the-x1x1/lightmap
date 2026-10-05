/* LightMap service worker — offline project cache (roadmap Phase 9, first deliverable).
 *
 * What works offline: the app shell (last visited page + Next's hashed static chunks) and the
 * signed-in user's own saved projects, viewpoints, session and entitlements as last fetched.
 * Astronomy runs in the browser, so sun/moon times, the timeline and the light finder work at a
 * saved place with no network; weather falls back to scenarios and the 3D globe to the overlay.
 *
 * What is never cached: third-party map, terrain and weather data (licences and freshness),
 * Cesium's assets (size), anything that is not a GET, and other users' data. Saved-project data is
 * dropped on sign-out, on account deletion and when the session comes back signed out.
 *
 * Plain JS with no build step; `apps/web/tests/unit/sw.test.ts` runs it in a sandbox.
 */
const VERSION = 'v1';
const SHELL = `lightmap-shell-${VERSION}`;
const STATIC = `lightmap-static-${VERSION}`;
const USER = `lightmap-user-${VERSION}`;
const CURRENT = [SHELL, STATIC, USER];
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
/** Header added to responses served from the cache: when they were stored (ISO 8601). */
const CACHED_AT = 'x-lightmap-cached-at';
const NETWORK_TIMEOUT_MS = 4000;
/** Hashed chunks from old deploys pile up; keep the newest this many. */
const STATIC_MAX_ENTRIES = 400;

/** API reads that belong to the signed-in user and are worth having in the field. */
const USER_API = [
  /^\/api\/projects(\/[^/]+)?$/,
  /^\/api\/auth\/session$/,
  /^\/api\/account\/entitlements$/,
  /^\/api\/scene\/capabilities$/,
];
/** Writes after which the user's cached data must go. */
const CLEAR_ON = [/^\/api\/auth\/signout$/, /^\/api\/account\/delete$/];

/** Which caching policy a request gets: 'navigate' | 'static' | 'user' | 'clear' | null (network only). */
function classify(request, origin) {
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  if (request.method !== 'GET') {
    return CLEAR_ON.some((re) => re.test(url.pathname)) ? 'clear' : null;
  }
  if (request.mode === 'navigate') return 'navigate';
  if (url.pathname.startsWith('/_next/static/')) return 'static';
  // Icons and the manifest; never '/' itself — Next's RSC fetches hit '/?_rsc=…' and must stay live.
  if (url.pathname !== '/' && SHELL_URLS.includes(url.pathname)) return 'static';
  if (USER_API.some((re) => re.test(url.pathname))) return 'user';
  return null;
}

async function stamp(response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, new Date().toISOString());
  const body = await response.clone().arrayBuffer();
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('network timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function notify(url, cachedAt) {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const c of clients) c.postMessage({ type: 'lightmap:served-from-cache', url, cachedAt });
}

async function clearUserData() {
  await caches.delete(USER);
}

/**
 * Network first (with a timeout), cached copy when the network fails. Only 200s are stored, under
 * `storeAs` (default: the request itself); `null` stores nothing.
 */
async function networkFirst(request, cacheName, fallbackUrl, storeAs) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    const key = storeAs === undefined ? request : storeAs;
    if (key !== null && res.ok && !res.redirected) await cache.put(key, await stamp(res));
    return res;
  } catch (err) {
    const hit = (await cache.match(request)) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (!hit) throw err;
    await notify(request.url, hit.headers.get(CACHED_AT));
    return hit;
  }
}

/** Hashed, immutable assets: cache first. */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    await trim(cache, STATIC_MAX_ENTRIES);
  }
  return res;
}

/** Drop the oldest entries (Cache keys come back in insertion order). */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/** The session came back signed out: nothing of the previous user may stay. */
async function sessionGuard(request) {
  const res = await networkFirst(request, USER);
  if (!res.headers.get(CACHED_AT)) {
    try {
      const body = await res.clone().json();
      if (!body || !body.user) await clearUserData();
    } catch {
      /* not JSON: leave the cache alone */
    }
  }
  return res;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Best effort: a missing icon must not stop the worker installing.
      await Promise.all(
        SHELL_URLS.map(async (u) => {
          try {
            const res = await fetch(u, { cache: 'reload' });
            if (res.ok) await cache.put(u, await stamp(res));
          } catch {
            /* offline during install */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('lightmap-') && !CURRENT.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'lightmap:clear-user-data')
    event.waitUntil(clearUserData());
});

self.addEventListener('fetch', (event) => {
  const kind = classify(event.request, self.location.origin);
  if (!kind) return;
  if (kind === 'clear') {
    event.waitUntil(clearUserData());
    return; // the write itself goes to the network untouched
  }
  if (kind === 'navigate') {
    // Only the planner page (no server-rendered user data) is stored, under one key so that
    // `/?source=pwa` and friends share it; other pages fall back to it offline.
    const isHome = new URL(event.request.url).pathname === '/';
    event.respondWith(networkFirst(event.request, SHELL, '/', isHome ? '/' : null));
  } else if (kind === 'static') event.respondWith(cacheFirst(event.request));
  else if (new URL(event.request.url).pathname === '/api/auth/session')
    event.respondWith(sessionGuard(event.request));
  else event.respondWith(networkFirst(event.request, USER));
});

// Exposed for the unit test sandbox only.
self.__lightmapSw = { classify, CACHED_AT, SHELL, STATIC, USER };

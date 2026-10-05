/* LightMap service worker — offline project cache (roadmap Phase 9, first deliverable).
 *
 * What works offline: the app shell (the planner page + Next's hashed static chunks + icons) and
 * the signed-in user's own saved projects, viewpoints, session and entitlements as last fetched.
 * Astronomy runs in the browser, so sun/moon times, the timeline and the light finder work at a
 * saved place with no network; weather falls back to scenarios and the 3D globe to the overlay.
 *
 * What is never cached: third-party map, terrain and weather data (licences and freshness),
 * Cesium's assets (size), anything that is not a GET, Next's RSC payloads, and other users' data.
 * Saved-project data is dropped on sign-out, on account deletion, when the session comes back
 * signed out, and when a different user's session appears.
 *
 * Responses are always handed to the page as soon as they arrive; caching happens afterwards in
 * `event.waitUntil`, so the worker never delays first byte or streaming.
 *
 * Plain JS with no build step; `apps/web/tests/unit/sw.test.ts` runs it in a sandbox.
 */
const VERSION = 'v1';
const SHELL = `lightmap-shell-${VERSION}`;
const STATIC = `lightmap-static-${VERSION}`;
const USER = `lightmap-user-${VERSION}`;
const CURRENT = [SHELL, STATIC, USER];
/** Un-hashed shell files: stale-while-revalidate from the SHELL cache. */
const SHELL_URLS = ['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
/** Header added to responses served from the cache: when they were stored (ISO 8601). */
const CACHED_AT = 'x-lightmap-cached-at';
/** User API reads give up on the network after this and fall back to the cache. Navigations never time out: a slow network must not serve a previous deploy's HTML. */
const API_TIMEOUT_MS = 8000;
/** Hashed chunks from old deploys pile up; keep the newest this many. */
const STATIC_MAX_ENTRIES = 400;
/** Synthetic key under which the current user's id is remembered (USER cache). */
const SESSION_USER_KEY = '/__lightmap/session-user';

/** API reads that belong to the signed-in user and are worth having in the field. */
const USER_API = [
  /^\/api\/projects(\/[^/]+)?$/,
  /^\/api\/auth\/session$/,
  /^\/api\/account\/entitlements$/,
  /^\/api\/scene\/capabilities$/,
];
/** Writes after which the user's cached data must go. */
const CLEAR_ON = [/^\/api\/auth\/signout$/, /^\/api\/account\/delete$/];
/** Writes after which the cached project list and details are stale. */
const PROJECTS_WRITE = [/^\/api\/projects(\/|$)/, /^\/api\/viewpoints(\/|$)/];

/**
 * Which caching policy a request gets:
 * 'navigate' | 'static' | 'shell' | 'user' | 'clear' | 'invalidate-projects' | null (network only).
 */
function classify(request, origin) {
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  if (request.method !== 'GET') {
    if (CLEAR_ON.some((re) => re.test(url.pathname))) return 'clear';
    if (PROJECTS_WRITE.some((re) => re.test(url.pathname))) return 'invalidate-projects';
    return null;
  }
  if (request.mode === 'navigate') return 'navigate';
  if (url.pathname.startsWith('/_next/static/')) return 'static';
  if (SHELL_URLS.includes(url.pathname)) return 'shell';
  // '/?_rsc=…' (Next's RSC fetches) are plain GETs and stay live.
  if (USER_API.some((re) => re.test(url.pathname))) return 'user';
  return null;
}

async function stamp(response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, new Date().toISOString());
  const body = await response.arrayBuffer();
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function withTimeout(promise, ms) {
  if (!ms) return promise;
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

async function tell(clientId, message) {
  const client = clientId ? await self.clients.get(clientId) : null;
  if (client) client.postMessage(message);
  else for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage(message);
}

async function clearUserData() {
  await caches.delete(USER);
}

/** The project list and every project detail: stale after any project/viewpoint write. */
async function invalidateProjects() {
  const cache = await caches.open(USER);
  for (const req of await cache.keys())
    if (/^\/api\/projects(\/|$)/.test(new URL(req.url).pathname)) await cache.delete(req);
}

/** Store a copy of a successful response (in the background, after the page has it). */
async function store(cacheName, key, response) {
  if (!response.ok || response.redirected) return;
  const cache = await caches.open(cacheName);
  await cache.put(key, await stamp(response));
}

/** Drop the oldest entries (Cache keys come back in insertion order). */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/**
 * Network first; the cached copy only when the network fails. The live response is returned at
 * once and stored afterwards under `storeAs` (default: the request; `null` stores nothing).
 */
async function networkFirst(event, cacheName, opts) {
  const { request, clientId } = event;
  const fallbackUrl = opts.fallbackUrl;
  const storeAs = opts.storeAs === undefined ? request : opts.storeAs;
  try {
    const res = await withTimeout(fetch(request), opts.timeoutMs);
    if (storeAs !== null) event.waitUntil(store(cacheName, storeAs, res.clone()));
    event.waitUntil(tell(clientId, { type: 'lightmap:fresh', url: request.url }));
    return res;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const hit = (await cache.match(request)) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (!hit) throw err;
    event.waitUntil(
      tell(clientId, {
        type: 'lightmap:served-from-cache',
        url: request.url,
        cachedAt: hit.headers.get(CACHED_AT),
      }),
    );
    return hit;
  }
}

/** Hashed, immutable assets: cache first. */
async function cacheFirst(event) {
  const { request } = event;
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    event.waitUntil(
      (async () => {
        await cache.put(request, copy);
        await trim(cache, STATIC_MAX_ENTRIES);
      })(),
    );
  }
  return res;
}

/** Un-hashed shell files (icons, manifest): serve the copy, refresh it in the background. */
async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => store(SHELL, request, res.clone()).then(() => res))
    .catch(() => null);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  const res = await refresh;
  if (!res) throw new TypeError('offline and not cached');
  return res;
}

/**
 * Session reads police the user cache: signed out → everything goes; a different user than the
 * one whose data is cached → everything goes (then the new id is remembered).
 */
async function sessionGuard(event) {
  const res = await networkFirst(event, USER, {});
  if (res.headers.get(CACHED_AT)) return res; // served from cache: nothing new to learn
  event.waitUntil(
    (async () => {
      let body = null;
      try {
        body = await res.clone().json();
      } catch {
        return; // not JSON: leave the cache alone
      }
      const id = body && body.user && (body.user.id || body.user.email);
      if (!id) {
        await clearUserData();
        return;
      }
      const cache = await caches.open(USER);
      const prev = await cache.match(SESSION_USER_KEY);
      const prevId = prev ? await prev.text() : null;
      if (prevId !== null && prevId !== String(id)) await clearUserData();
      await (await caches.open(USER)).put(SESSION_USER_KEY, new Response(String(id)));
    })(),
  );
  return res;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Best effort: a missing icon must not stop the worker installing.
      await Promise.all(
        ['/', ...SHELL_URLS].map(async (u) => {
          try {
            const res = await fetch(u, { cache: 'reload' });
            if (res.ok && !res.redirected) await cache.put(u, await stamp(res));
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
  if (kind === 'invalidate-projects') {
    event.waitUntil(invalidateProjects());
    return;
  }
  if (kind === 'navigate') {
    // Only the planner page (no server-rendered user data) is stored, under one key so that
    // `/?source=pwa` and friends share it; other pages fall back to it offline.
    const isHome = new URL(event.request.url).pathname === '/';
    event.respondWith(
      networkFirst(event, SHELL, { fallbackUrl: '/', storeAs: isHome ? '/' : null }),
    );
  } else if (kind === 'static') event.respondWith(cacheFirst(event));
  else if (kind === 'shell') event.respondWith(staleWhileRevalidate(event));
  else if (new URL(event.request.url).pathname === '/api/auth/session')
    event.respondWith(sessionGuard(event));
  else event.respondWith(networkFirst(event, USER, { timeoutMs: API_TIMEOUT_MS }));
});

// Exposed for the unit test sandbox only.
self.__lightmapSw = { classify, CACHED_AT, SHELL, STATIC, USER, SESSION_USER_KEY };

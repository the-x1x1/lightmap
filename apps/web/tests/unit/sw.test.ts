// @vitest-environment node
/**
 * The service worker (public/sw.js) is plain JS with no build step; run it in a sandbox with an
 * in-memory CacheStorage and a scripted fetch, and drive its fetch events.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://lightmap.test';
const SOURCE = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');

class FakeCache {
  readonly store = new Map<string, Response>();
  private key(r: RequestInfo | URL): string {
    return new URL(typeof r === 'string' || r instanceof URL ? r : r.url, ORIGIN).href;
  }
  async match(r: RequestInfo | URL) {
    const hit = this.store.get(this.key(r));
    return hit ? hit.clone() : undefined;
  }
  async put(r: RequestInfo | URL, res: Response) {
    this.store.delete(this.key(r));
    this.store.set(this.key(r), res.clone());
  }
  async delete(r: RequestInfo | URL) {
    return this.store.delete(this.key(r));
  }
  async keys() {
    return [...this.store.keys()].map((u) => new Request(u));
  }
}

class FakeCaches {
  readonly map = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.map.has(name)) this.map.set(name, new FakeCache());
    return this.map.get(name)!;
  }
  async delete(name: string) {
    return this.map.delete(name);
  }
  async keys() {
    return [...this.map.keys()];
  }
}

type Handler = (e: unknown) => void;

function boot(fetchImpl: (req: Request | string) => Promise<Response>) {
  const listeners = new Map<string, Handler>();
  const messages: unknown[] = [];
  const caches = new FakeCaches();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => listeners.set(type, fn),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [{ postMessage: (m: unknown) => messages.push(m) }],
    },
  } as Record<string, unknown>;
  const ctx = vm.createContext({
    self,
    caches,
    fetch: (r: Request | string) =>
      fetchImpl(typeof r === 'string' ? new Request(new URL(r, ORIGIN)) : r),
    Headers,
    Request,
    Response,
    URL,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    console,
  });
  vm.runInContext(SOURCE, ctx);
  const sw = self['__lightmapSw'] as {
    classify: (r: { url: string; method: string; mode?: string }, origin: string) => string | null;
    CACHED_AT: string;
    SHELL: string;
    STATIC: string;
    USER: string;
  };

  /** Dispatch a fetch event; resolves to the worker's response, or null when it passes through. */
  async function dispatch(url: string, init: { method?: string; mode?: string } = {}) {
    let responded: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    const request = {
      url: new URL(url, ORIGIN).href,
      method: init.method ?? 'GET',
      mode: init.mode ?? 'cors',
    };
    listeners.get('fetch')!({
      request,
      respondWith: (p: Promise<Response>) => (responded = p),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    return responded ? await responded : null;
  }

  async function lifecycle(type: 'install' | 'activate') {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }

  return { sw, caches, messages, dispatch, lifecycle, listeners };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('service worker — offline project cache', () => {
  let online = true;
  let served: string[] = [];
  const network = async (req: Request | string) => {
    const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
    served.push(url.pathname + url.search);
    if (!online) throw new TypeError('Failed to fetch');
    if (url.pathname === '/api/projects') return json({ projects: [{ id: 'p1', name: 'Kailua' }] });
    if (url.pathname === '/api/auth/session') return json({ user: { id: 'u1' } });
    if (url.pathname === '/') return new Response('<html>planner</html>', { status: 200 });
    if (url.pathname.startsWith('/_next/static/')) return new Response('chunk', { status: 200 });
    return new Response('ok', { status: 200 });
  };
  beforeEach(() => {
    online = true;
    served = [];
  });

  it('classifies requests: only same-origin GETs of the shell, chunks and the user’s own data', () => {
    const { sw } = boot(network);
    const c = (url: string, method = 'GET', mode = 'cors') =>
      sw.classify({ url: new URL(url, ORIGIN).href, method, mode }, ORIGIN);
    expect(c('/', 'GET', 'navigate')).toBe('navigate');
    expect(c('/_next/static/chunks/app-abc123.js')).toBe('static');
    expect(c('/icon-192.png')).toBe('static');
    // Next's RSC fetches to '/' must never be served stale.
    expect(c('/?_rsc=1x2y')).toBeNull();
    expect(c('/api/projects')).toBe('user');
    expect(c('/api/projects/abc')).toBe('user');
    expect(c('/api/auth/session')).toBe('user');
    expect(c('/api/account/entitlements')).toBe('user');
    // Not cached: weather/terrain (licences, freshness), other APIs, writes, other origins.
    expect(c('/api/weather?lat=1&lng=2')).toBeNull();
    expect(c('/api/projects/abc/viewpoints', 'POST')).toBeNull();
    expect(c('https://terrain.reearth.land/tiles/1/2/3.terrain')).toBeNull();
    expect(c('/cesium/Assets/foo.json')).toBeNull();
    // Sign-out and account deletion clear the user's cached data.
    expect(c('/api/auth/signout', 'POST')).toBe('clear');
    expect(c('/api/account/delete', 'POST')).toBe('clear');
  });

  it('serves saved projects from the cache when the network fails, stamped and announced', async () => {
    const w = boot(network);
    const live = await w.dispatch('/api/projects');
    expect(await live!.json()).toMatchObject({ projects: [{ id: 'p1' }] });
    online = false;
    const cached = await w.dispatch('/api/projects');
    expect(cached!.status).toBe(200);
    expect(await cached!.json()).toMatchObject({ projects: [{ id: 'p1', name: 'Kailua' }] });
    const at = cached!.headers.get(w.sw.CACHED_AT);
    expect(at).not.toBeNull();
    expect(Number.isNaN(Date.parse(at!))).toBe(false);
    expect(w.messages).toContainEqual({
      type: 'lightmap:served-from-cache',
      url: `${ORIGIN}/api/projects`,
      cachedAt: at,
    });
  });

  it('with nothing cached, an offline request fails as it would without the worker', async () => {
    const w = boot(network);
    online = false;
    await expect(w.dispatch('/api/projects/never-seen')).rejects.toThrow('Failed to fetch');
  });

  it('offline navigations to any page fall back to the cached planner', async () => {
    const w = boot(network);
    await w.dispatch('/?source=pwa', { mode: 'navigate' });
    online = false;
    const res = await w.dispatch('/account', { mode: 'navigate' });
    expect(await res!.text()).toBe('<html>planner</html>');
    // Other pages are never stored themselves.
    online = true;
    await w.dispatch('/account', { mode: 'navigate' });
    const shell = await w.caches.open(w.sw.SHELL);
    expect([...shell.store.keys()]).toEqual([`${ORIGIN}/`]);
  });

  it('hashed chunks are cache-first: the second load never touches the network', async () => {
    const w = boot(network);
    await w.dispatch('/_next/static/chunks/main-1.js');
    online = false;
    const res = await w.dispatch('/_next/static/chunks/main-1.js');
    expect(await res!.text()).toBe('chunk');
    expect(served.filter((s) => s.includes('main-1')).length).toBe(1);
  });

  it('signing out drops the previous user’s cached projects', async () => {
    const w = boot(network);
    await w.dispatch('/api/projects');
    expect(w.caches.map.has(w.sw.USER)).toBe(true);
    const passthrough = await w.dispatch('/api/auth/signout', { method: 'POST' });
    expect(passthrough).toBeNull(); // the write itself still goes to the network
    expect(w.caches.map.has(w.sw.USER)).toBe(false);
  });

  it('a session that comes back signed out also clears the cache', async () => {
    let signedIn = true;
    const w = boot(async (req) => {
      const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
      if (url.pathname === '/api/auth/session') return json(signedIn ? { user: { id: 'u1' } } : {});
      return network(req);
    });
    await w.dispatch('/api/projects');
    await w.dispatch('/api/auth/session');
    expect((await w.caches.open(w.sw.USER)).store.size).toBe(2);
    signedIn = false;
    await w.dispatch('/api/auth/session');
    expect(w.caches.map.has(w.sw.USER)).toBe(false);
  });

  it('install precaches the shell best-effort; activate deletes old versions only', async () => {
    const w = boot(async (req) => {
      const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
      if (url.pathname === '/icon-512.png') throw new TypeError('Failed to fetch');
      return network(req);
    });
    await w.caches.open('lightmap-shell-v0');
    await w.caches.open('someone-elses-cache');
    await w.lifecycle('install');
    const shell = await w.caches.open(w.sw.SHELL);
    expect(shell.store.has(`${ORIGIN}/`)).toBe(true);
    expect(shell.store.has(`${ORIGIN}/icon-512.png`)).toBe(false);
    await w.lifecycle('activate');
    const keys = await w.caches.keys();
    expect(keys).not.toContain('lightmap-shell-v0');
    expect(keys).toContain('someone-elses-cache');
    expect(keys).toContain(w.sw.SHELL);
  });
});

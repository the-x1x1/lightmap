import { describe, expect, it } from 'vitest';
import {
  evaluateSmoke,
  smokeExitCode,
  type SmokeInputs,
  type SmokeResponse,
} from '../src/smoke.ts';

const res = (
  status: number,
  body: unknown = '',
  headers: Record<string, string> = {},
): SmokeResponse => ({
  status,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const homeHeaders = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'nonce-abc' 'wasm-unsafe-eval'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(self), geolocation=(self)',
};

function good(): SmokeInputs {
  return {
    expectedVersion: '0.2.0',
    home: res(
      200,
      '<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest"></head></html>',
      homeHeaders,
    ),
    health: res(200, { ok: true, version: '0.2.0', database: 'ok', fixtureMode: false }),
    capabilities: res(200, {
      fixtureMode: false,
      devBanner: false,
      authMethods: { email: true, google: false, devLogin: false },
      billingConfigured: true,
      analytics: false,
    }),
    manifest: res(200, { name: 'LightMap', start_url: '/?source=pwa', icons: [{}, {}] }),
    serviceWorker: res(200, 'self.addEventListener', {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
    }),
    privacy: res(
      200,
      '<html><h1>Privacy</h1><p>Contact support@example.com.</p><script>self.__next_f.push([1,"[\\"app-pages-internals\\",\\"static/chunks/x.js\\"]"])</script></html>',
    ),
    profileUnauthenticated: res(401, { error: { code: 'unauthenticated' } }),
    stripeWebhookUnsigned: res(400, 'missing signature'),
  };
}

const fails = (f: ReturnType<typeof evaluateSmoke>) =>
  f.filter((x) => x.level === 'fail').map((x) => x.check);
const warns = (f: ReturnType<typeof evaluateSmoke>) =>
  f.filter((x) => x.level === 'warn').map((x) => x.check);
const expectAll = (have: string[], want: string[]) => {
  for (const w of want) expect(have).toContain(w);
};

describe('production smoke checks (plan §43)', () => {
  it('a well-configured deployment passes with no failures or warnings', () => {
    const f = evaluateSmoke(good());
    expect(fails(f)).toEqual([]);
    expect(warns(f)).toEqual([]);
    expect(smokeExitCode(f)).toBe(0);
  });

  it('flags the wrong build, fixture mode, a broken database and a dev sign-in', () => {
    const i = good();
    i.health = res(200, { ok: true, version: '0.1.0', database: 'error', fixtureMode: true });
    i.capabilities = res(200, {
      fixtureMode: true,
      devBanner: true,
      authMethods: { email: true, google: false, devLogin: true },
      billingConfigured: true,
      analytics: true,
    });
    const f = evaluateSmoke(i);
    expectAll(fails(f), [
      'health.version',
      'health.database',
      'health.fixtureMode',
      'capabilities.fixtureMode',
      'capabilities.devBanner',
      'capabilities.devLogin',
    ]);
    expect(smokeExitCode(f)).toBe(1);
  });

  it('checks the security headers and refuses unsafe-eval', () => {
    const i = good();
    i.home = res(200, '<html></html>', {
      ...homeHeaders,
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-eval'",
      'permissions-policy': 'geolocation=(self)',
      'strict-transport-security': '',
    });
    const f = evaluateSmoke(i);
    expectAll(fails(f), ['home.csp', 'home.permissions', 'home.hsts']);
    expect(warns(f)).toContain('home.manifest-link');
  });

  it('a cacheable or mistyped service worker and a thin manifest fail', () => {
    const i = good();
    i.serviceWorker = res(200, '', {
      'content-type': 'text/plain',
      'cache-control': 'max-age=3600',
    });
    i.manifest = res(200, { name: 'x', icons: [{}] });
    const f = evaluateSmoke(i);
    expectAll(fails(f), ['sw.type', 'sw.cache', 'manifest']);
  });

  it('known-incomplete setups are warnings, not failures', () => {
    const i = good();
    i.health = res(200, {
      ok: true,
      version: '0.2.0',
      database: 'unconfigured',
      fixtureMode: false,
    });
    i.capabilities = res(200, {
      fixtureMode: false,
      devBanner: false,
      authMethods: { email: false, google: false, devLogin: false },
      billingConfigured: false,
      analytics: false,
    });
    i.privacy = res(200, '<p>[legal entity name and address]</p>');
    i.profileUnauthenticated = res(503, '');
    i.stripeWebhookUnsigned = res(503, 'billing not configured');
    const f = evaluateSmoke(i);
    expect(fails(f)).toEqual([]);
    expectAll(warns(f), [
      'health.database',
      'capabilities.auth',
      'capabilities.billing',
      'privacy.placeholders',
      'auth.profile',
      'billing.webhook',
    ]);
    expect(smokeExitCode(f)).toBe(0);
  });

  it('an open profile route or an accepted unsigned webhook is a failure; HTTP errors are failures', () => {
    const i = good();
    i.profileUnauthenticated = res(200, { units: 'metric' });
    i.stripeWebhookUnsigned = res(200, { received: true });
    i.privacy = res(404, '');
    const f = evaluateSmoke(i);
    expectAll(fails(f), ['auth.profile', 'billing.webhook', 'privacy']);
    // A redirecting home page says where it went; an unreachable host says why.
    const j = good();
    j.home = res(308, '', { location: 'https://www.example.com/' });
    j.health = { status: 0, headers: {}, body: 'fetch failed: ECONNREFUSED' };
    const g = evaluateSmoke(j);
    expect(g.find((x) => x.check === 'home')?.detail).toContain(
      'redirects to https://www.example.com/',
    );
    expect(g.find((x) => x.check === 'health')?.detail).toContain('ECONNREFUSED');
  });

  it('the optional search probe must come from a live geocoder', () => {
    const i = good();
    i.search = res(200, { results: [{}], provider: { id: 'fixture', isFixture: true } });
    expect(fails(evaluateSmoke(i))).toContain('search.provider');
    i.search = res(200, { results: [{}, {}], provider: { id: 'nominatim', isFixture: false } });
    const f = evaluateSmoke(i);
    expect(fails(f)).toEqual([]);
    expect(f.find((x) => x.check === 'search')?.detail).toContain('2 results');
  });
});

/**
 * Production smoke test (plan §43 "end-to-end production smoke test", `QA_PLAN.md` §5): the
 * checks a deployed build must pass, as pure functions over fetched responses so they are unit
 * tested here and run by `scripts/smoke-prod.ts` against a URL. Every check names what it looked
 * at and what it found; `fail` blocks a release, `warn` is a known-incomplete setup.
 */

export interface SmokeResponse {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  body: string;
}

export interface SmokeInputs {
  /** The version the deployment should report (`apps/web/package.json`). */
  expectedVersion: string;
  /** GET / */
  home: SmokeResponse;
  /** GET /api/health */
  health: SmokeResponse;
  /** GET /api/scene/capabilities */
  capabilities: SmokeResponse;
  /** GET /manifest.webmanifest */
  manifest: SmokeResponse;
  /** GET /sw.js */
  serviceWorker: SmokeResponse;
  /** GET /legal/privacy */
  privacy: SmokeResponse;
  /** GET /api/account/profile with no session. */
  profileUnauthenticated: SmokeResponse;
  /** POST /api/webhooks/stripe with no signature. */
  stripeWebhookUnsigned: SmokeResponse;
  /** GET /api/location/search?q=Kailua (optional: costs a geocoder call). */
  search?: SmokeResponse;
}

export type SmokeLevel = 'ok' | 'warn' | 'fail';

export interface SmokeFinding {
  check: string;
  level: SmokeLevel;
  detail: string;
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(body);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function header(r: SmokeResponse, name: string): string {
  return r.headers[name.toLowerCase()] ?? '';
}

export function evaluateSmoke(i: SmokeInputs): SmokeFinding[] {
  const out: SmokeFinding[] = [];
  const add = (check: string, level: SmokeLevel, detail: string) =>
    out.push({ check, level, detail });
  const expectStatus = (check: string, r: SmokeResponse, status: number): boolean => {
    if (r.status === status) return true;
    add(check, 'fail', `expected HTTP ${status}, got ${r.status}`);
    return false;
  };

  // Health: the process is up, talks to its database, is the build we meant, and is not on fixtures.
  if (expectStatus('health', i.health, 200)) {
    const h = parseJson(i.health.body);
    if (!h) add('health', 'fail', 'body is not a JSON object');
    else {
      if (h['ok'] !== true) add('health', 'fail', `ok is ${JSON.stringify(h['ok'])}`);
      if (h['database'] === 'ok') add('health.database', 'ok', 'database ok');
      else if (h['database'] === 'unconfigured')
        add('health.database', 'warn', 'no database: accounts, projects and billing are off');
      else add('health.database', 'fail', `database ${JSON.stringify(h['database'])}`);
      if (h['version'] === i.expectedVersion) add('health.version', 'ok', String(h['version']));
      else
        add(
          'health.version',
          'fail',
          `deployed ${JSON.stringify(h['version'])}, expected ${i.expectedVersion}`,
        );
      if (h['fixtureMode'] === false) add('health.fixtureMode', 'ok', 'live providers');
      else add('health.fixtureMode', 'fail', 'fixture mode is on (a fixture provider is active)');
    }
  }

  // Home: served, with the security headers of plan §29 and a CSP that needs no unsafe-eval.
  if (expectStatus('home', i.home, 200)) {
    const csp = header(i.home, 'content-security-policy');
    if (!csp) add('home.csp', 'fail', 'no Content-Security-Policy header');
    else if (/unsafe-eval/.test(csp)) add('home.csp', 'fail', "CSP allows 'unsafe-eval'");
    else if (!/default-src\s+'self'/.test(csp))
      add('home.csp', 'fail', "CSP default-src is not 'self'");
    else add('home.csp', 'ok', 'strict CSP');
    if (!header(i.home, 'strict-transport-security'))
      add('home.hsts', 'fail', 'no Strict-Transport-Security header');
    if (header(i.home, 'x-content-type-options').toLowerCase() !== 'nosniff')
      add('home.nosniff', 'fail', 'X-Content-Type-Options is not nosniff');
    if (!header(i.home, 'referrer-policy')) add('home.referrer', 'fail', 'no Referrer-Policy');
    const pp = header(i.home, 'permissions-policy');
    if (!/camera=\(self\)/.test(pp))
      add('home.permissions', 'fail', 'Permissions-Policy does not restrict camera to self');
    if (!/<html/i.test(i.home.body)) add('home.body', 'fail', 'response is not an HTML document');
    else if (!/rel="?manifest"?/i.test(i.home.body))
      add('home.manifest-link', 'warn', 'no manifest link in the document (install prompt off)');
  }

  // Capabilities: what the client will believe about this deployment.
  if (expectStatus('capabilities', i.capabilities, 200)) {
    const c = parseJson(i.capabilities.body);
    if (!c) add('capabilities', 'fail', 'body is not a JSON object');
    else {
      if (c['fixtureMode'] !== false) add('capabilities.fixtureMode', 'fail', 'fixture mode on');
      if (c['devBanner'] !== false) add('capabilities.devBanner', 'fail', 'development banner on');
      const auth = c['authMethods'] as Record<string, unknown> | undefined;
      if (auth?.['devLogin'] === true)
        add('capabilities.devLogin', 'fail', 'dev sign-in is enabled');
      if (auth && !auth['email'] && !auth['google'])
        add('capabilities.auth', 'warn', 'no sign-in method configured');
      if (c['billingConfigured'] !== true)
        add('capabilities.billing', 'warn', 'billing not configured (no checkout)');
      if (typeof c['analytics'] !== 'boolean')
        add('capabilities.analytics', 'fail', 'analytics flag missing (older build?)');
      else add('capabilities.analytics', 'ok', c['analytics'] ? 'events recorded' : 'events off');
    }
  }

  // Installable: manifest and the service worker, which must never be cached by the browser.
  if (expectStatus('manifest', i.manifest, 200)) {
    const m = parseJson(i.manifest.body);
    const icons = m?.['icons'];
    if (!m || typeof m['name'] !== 'string' || !Array.isArray(icons) || icons.length < 2)
      add('manifest', 'fail', 'manifest lacks a name or two icons');
    if (m && typeof m['start_url'] !== 'string')
      add('manifest', 'fail', 'manifest lacks start_url');
  }
  if (expectStatus('sw', i.serviceWorker, 200)) {
    if (!/javascript/.test(header(i.serviceWorker, 'content-type')))
      add(
        'sw.type',
        'fail',
        `service worker served as ${header(i.serviceWorker, 'content-type') || 'unknown'}`,
      );
    if (!/no-(cache|store)/.test(header(i.serviceWorker, 'cache-control')))
      add('sw.cache', 'fail', 'service worker is cacheable (updates would stall)');
  }

  // Legal: present and no bracketed placeholders left for counsel.
  if (expectStatus('privacy', i.privacy, 200)) {
    const placeholders = i.privacy.body.match(/\[[^\]\n]{3,80}\]/g) ?? [];
    if (placeholders.length)
      add(
        'privacy.placeholders',
        'warn',
        `bracketed placeholders remain: ${placeholders.slice(0, 3).join(', ')}`,
      );
    else add('privacy', 'ok', 'no placeholders');
  }

  // Authorisation and billing plumbing answer as they should to a stranger.
  if (i.profileUnauthenticated.status === 401) add('auth.profile', 'ok', '401 without a session');
  else if (i.profileUnauthenticated.status === 503)
    add('auth.profile', 'warn', 'no database: profile route unavailable');
  else
    add(
      'auth.profile',
      'fail',
      `profile route answered ${i.profileUnauthenticated.status} without a session`,
    );
  if (i.stripeWebhookUnsigned.status === 400)
    add('billing.webhook', 'ok', 'unsigned event refused');
  else if (i.stripeWebhookUnsigned.status === 503)
    add('billing.webhook', 'warn', 'billing not configured');
  else
    add('billing.webhook', 'fail', `unsigned webhook answered ${i.stripeWebhookUnsigned.status}`);

  // Place search on the live geocoder (optional).
  if (i.search) {
    if (expectStatus('search', i.search, 200)) {
      const s = parseJson(i.search.body);
      const provider = s?.['provider'] as Record<string, unknown> | undefined;
      const results = s?.['results'];
      if (provider?.['isFixture'] === true) add('search.provider', 'fail', 'fixture geocoder');
      else if (!Array.isArray(results) || results.length === 0)
        add('search.results', 'warn', 'no results for the probe query');
      else add('search', 'ok', `${results.length} results from ${String(provider?.['id'])}`);
    }
  }

  return out;
}

/** The exit status a script should use: 1 on any failure. */
export function smokeExitCode(findings: SmokeFinding[]): 0 | 1 {
  return findings.some((f) => f.level === 'fail') ? 1 : 0;
}

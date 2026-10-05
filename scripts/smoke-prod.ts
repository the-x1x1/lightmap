/**
 * `pnpm smoke:prod <url> [--search]` — the release smoke test (QA_PLAN.md §5, plan §43) against a
 * deployed build: health, security headers, capabilities, manifest and service worker, the legal
 * page, and that the profile and webhook routes refuse a stranger. `--search` also exercises the
 * live geocoder once. Exit 1 on any failure; warnings are printed and tolerated.
 */
import { readFileSync } from 'node:fs';
import {
  evaluateSmoke,
  smokeExitCode,
  type SmokeResponse,
} from '../packages/observability/src/index.ts';

const [, , base, ...flags] = process.argv;
if (!base || !/^https?:\/\//.test(base)) {
  console.error('usage: pnpm smoke:prod https://app.example.com [--search]');
  process.exit(2);
}
const root = base.replace(/\/+$/, '');
const version = (
  JSON.parse(readFileSync(new URL('../apps/web/package.json', import.meta.url), 'utf8')) as {
    version?: string;
  }
).version;
if (!version) {
  console.error('apps/web/package.json has no version');
  process.exit(2);
}

async function probe(path: string, init?: RequestInit): Promise<SmokeResponse> {
  try {
    const res = await fetch(`${root}${path}`, {
      redirect: 'manual', // the final URL is what is tested; a redirect is reported with its target
      signal: AbortSignal.timeout(15_000),
      ...init,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return { status: res.status, headers, body: await res.text() };
  } catch (e) {
    return { status: 0, headers: {}, body: e instanceof Error ? e.message : String(e) };
  }
}

const [home, health, capabilities, manifest, serviceWorker, privacy, profile, webhook] =
  await Promise.all([
    probe('/'),
    probe('/api/health'),
    probe('/api/scene/capabilities'),
    probe('/manifest.webmanifest'),
    probe('/sw.js'),
    probe('/legal/privacy'),
    probe('/api/account/profile'),
    probe('/api/webhooks/stripe', { method: 'POST', body: '{}' }),
  ]);
const search = flags.includes('--search')
  ? await probe('/api/location/search?q=Kailua')
  : undefined;

const findings = evaluateSmoke({
  expectedVersion: version,
  home,
  health,
  capabilities,
  manifest,
  serviceWorker,
  privacy,
  profileUnauthenticated: profile,
  stripeWebhookUnsigned: webhook,
  ...(search ? { search } : {}),
});
for (const f of findings) {
  const tag = f.level === 'fail' ? 'FAIL' : f.level === 'warn' ? 'warn' : ' ok ';
  console.log(`${tag}  ${f.check}: ${f.detail}`);
}
const fails = findings.filter((f) => f.level === 'fail').length;
const warns = findings.filter((f) => f.level === 'warn').length;
console.log(`\n${root} · version ${version} · ${fails} failed · ${warns} warnings`);
process.exit(smokeExitCode(findings));

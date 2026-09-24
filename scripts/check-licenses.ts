/**
 * Dependency licence gate (plan §14): walks node_modules, reads every package's licence, fails on
 * anything not in the allowlist unless `scripts/license-allowlist.json` records an explicit,
 * reasoned exception. Also writes THIRD_PARTY_NOTICES.md when run with --write-notices.
 * Zero dependencies so it runs before/without pnpm install completing.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface PkgJson {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
  repository?: string | { url?: string };
  homepage?: string;
  private?: boolean;
}

interface Allowlist {
  permissive: string[];
  exceptions: Record<string, { license: string; reason: string; approvedBy: string; date: string }>;
  ignore: string[];
}

const root = resolve(process.argv[1] ? join(process.argv[1], '..', '..') : '.');
const allowlist = JSON.parse(
  readFileSync(join(root, 'scripts', 'license-allowlist.json'), 'utf8'),
) as Allowlist;
const writeNotices = process.argv.includes('--write-notices');

function licenseOf(p: PkgJson): string {
  if (typeof p.license === 'string') return p.license;
  if (p.license && typeof p.license === 'object' && p.license.type) return p.license.type;
  if (Array.isArray(p.licenses) && p.licenses.length)
    return p.licenses.map((l) => l.type ?? '?').join(' OR ');
  return 'UNKNOWN';
}

/** Split SPDX expressions and accept when any alternative is permissive ("MIT OR Apache-2.0"). */
function isPermissive(expr: string): boolean {
  const cleaned = expr.replace(/[()]/g, '');
  if (/\bAND\b/.test(cleaned))
    return cleaned.split(/\bAND\b/).every((part) => isPermissive(part.trim()));
  return cleaned
    .split(/\bOR\b/)
    .some((part) => allowlist.permissive.includes(part.trim().replace(/\+$/, '')));
}

function* walk(dir: string, depth = 0): Generator<string> {
  if (!existsSync(dir) || depth > 6) return;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(full)) yield* visit(join(full, scoped), depth);
    } else yield* visit(full, depth);
  }
}
function* visit(pkgDir: string, depth: number): Generator<string> {
  const pj = join(pkgDir, 'package.json');
  if (existsSync(pj)) yield pkgDir;
  const nested = join(pkgDir, 'node_modules');
  if (existsSync(nested) && statSync(nested).isDirectory()) yield* walk(nested, depth + 1);
}

const roots = [join(root, 'node_modules'), join(root, 'node_modules', '.pnpm')];
const seen = new Map<string, { version: string; license: string; url: string }>();
for (const r of roots) {
  if (!existsSync(r)) continue;
  const dirs = r.endsWith('.pnpm')
    ? readdirSync(r)
        .map((d) => join(r, d, 'node_modules'))
        .flatMap((nm) => (existsSync(nm) ? [...walk(nm)] : []))
    : [...walk(r)];
  for (const dir of dirs) {
    let pkg: PkgJson;
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PkgJson;
    } catch {
      continue;
    }
    if (!pkg.name || pkg.private || pkg.name.startsWith('@lightmap/')) continue;
    const key = `${pkg.name}@${pkg.version ?? '?'}`;
    if (seen.has(key)) continue;
    const repo =
      typeof pkg.repository === 'string'
        ? pkg.repository
        : (pkg.repository?.url ?? pkg.homepage ?? '');
    seen.set(key, {
      version: pkg.version ?? '?',
      license: licenseOf(pkg),
      url: repo.replace(/^git\+/, '').replace(/\.git$/, ''),
    });
  }
}

if (seen.size === 0) {
  console.log('check-licenses: no node_modules found (run pnpm install first). Nothing to check.');
  process.exit(0);
}

const problems: string[] = [];
const rows: string[] = [];
for (const [key, info] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  const name = key.slice(0, key.lastIndexOf('@'));
  if (allowlist.ignore.includes(name)) continue;
  const exception = allowlist.exceptions[name];
  const ok = isPermissive(info.license) || (exception && exception.license === info.license);
  if (!ok)
    problems.push(
      `${key}: ${info.license}${info.license === 'UNKNOWN' ? ' (no licence field — needs review)' : ''}`,
    );
  rows.push(
    `| ${name} | ${info.version} | ${info.license}${exception ? ` (exception: ${exception.reason})` : ''} | ${info.url} |`,
  );
}

if (writeNotices) {
  const header = readFileSync(join(root, 'scripts', 'third-party-notices-header.md'), 'utf8');
  writeFileSync(
    join(root, 'THIRD_PARTY_NOTICES.md'),
    `${header}\n\n## Software dependencies (${rows.length})\n\n| Package | Version | Licence | Source |\n|---|---|---|---|\n${rows.join('\n')}\n`,
  );
  console.log(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages`);
}

if (problems.length > 0) {
  console.error(
    `check-licenses: ${problems.length} package(s) need review:\n  ${problems.join('\n  ')}\n\nAdd a reasoned exception to scripts/license-allowlist.json or replace the dependency (docs/DATA_SOURCES_AND_LICENSING.md §Code licences).`,
  );
  process.exit(1);
}
console.log(`check-licenses: ${seen.size} packages, all permissive or explicitly excepted.`);

/**
 * `pnpm release <version>` — bump every workspace package to <version>, prepend CHANGELOG from
 * commits since the last tag, commit and tag `v<version>`. Deploy is CI's job (release.yml).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: pnpm release <semver>');
  process.exit(2);
}
const sh = (c: string) =>
  execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
if (sh('git status --porcelain')) {
  console.error('working tree is not clean');
  process.exit(1);
}
const manifests = [
  'package.json',
  ...sh('git ls-files apps/*/package.json packages/*/package.json').split('\n'),
];
for (const m of manifests) {
  const j = JSON.parse(readFileSync(m, 'utf8')) as { version?: string };
  j.version = version;
  writeFileSync(m, JSON.stringify(j, null, 2) + '\n');
}
let lastTag = '';
try {
  lastTag = sh('git describe --tags --abbrev=0');
} catch {
  /* first release */
}
// Double quotes: single quotes are not quoting characters in cmd.exe (Windows).
const log = sh(
  `git log ${lastTag ? `${lastTag}..HEAD` : ''} --pretty="format:- %s (%h)" --no-merges`,
);
const date = new Date().toISOString().slice(0, 10);
const heading = `## v${version} — ${date}`;
const HEADER = /^# Changelog\n\n(?:(?!## )[^\n]*\n)*\n?/; // title + intro paragraph
const current = existsSync('CHANGELOG.md')
  ? readFileSync('CHANGELOG.md', 'utf8')
  : '# Changelog\n\n';
const header = HEADER.exec(current)?.[0] ?? '# Changelog\n\n';
const body = current.slice(header.length);
// Hand-written "## Unreleased" notes become this version's notes; otherwise list the commits.
const changelog = /^## Unreleased[ \t]*$/m.test(body)
  ? header + body.replace(/^## Unreleased[ \t]*$/m, heading)
  : `${header}${heading}\n\n${log || '- Initial release'}\n\n${body}`;
writeFileSync('CHANGELOG.md', changelog);
// Match the repo's formatting so CI's format check stays green after the release commit.
sh(`pnpm exec prettier --write CHANGELOG.md ${manifests.join(' ')}`);
sh(
  `git add -A && git commit -q -m "release: v${version}" && git tag -a v${version} -m "LightMap v${version}"`,
);
console.log(`tagged v${version}. Push with: git push --follow-tags`);

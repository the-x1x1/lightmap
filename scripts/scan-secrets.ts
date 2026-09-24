/** CI gate (plan §36): fail when something that looks like a live credential is committed. Zero deps. */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const patterns: Array<[string, RegExp]> = [
  ['Stripe live secret key', /sk_live_[0-9a-zA-Z]{16,}/],
  ['Stripe webhook secret', /whsec_[0-9a-zA-Z]{20,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Private key block', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Cesium ion token', /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{40,}/],
  [
    'Postgres URL with password',
    /postgres(ql)?:\/\/[^:\s]+:[^@\s]{8,}@(?!localhost|127\.0\.0\.1|db\b|postgres\b)/,
  ],
];
const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter(
    (f) =>
      f &&
      !f.endsWith('.png') &&
      !f.endsWith('.jpg') &&
      !f.includes('pnpm-lock') &&
      f !== 'scripts/scan-secrets.ts',
  );
const hits: string[] = [];
for (const f of files) {
  let text: string;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const [name, re] of patterns) if (re.test(text)) hits.push(`${f}: ${name}`);
}
if (hits.length) {
  console.error(`scan-secrets: possible secrets committed:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`scan-secrets: ${files.length} files clean`);

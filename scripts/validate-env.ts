/** `pnpm env:validate` — parse .env (if present) + process env and print issues. Exit 1 on errors. */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from '../packages/config/src/env.ts';

const raw: Record<string, string | undefined> = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (raw[m[1]!] === undefined) raw[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
  }
}
const { issues, ok, env } = parseEnv(raw);
for (const i of issues) console.log(`${i.severity === 'error' ? 'ERROR' : 'warn '}  ${i.key}: ${i.message}`);
console.log(`\nenvironment: ${env.NODE_ENV} · weather=${env.WEATHER_PROVIDER} geocoder=${env.GEOCODER_PROVIDER} terrain=${env.TERRAIN_PROVIDER} imagery=${env.IMAGERY_PROVIDER} · db=${env.DATABASE_URL ? 'configured' : 'none'} · stripe=${env.STRIPE_SECRET_KEY ? 'configured' : 'none'}`);
console.log(ok ? 'OK' : 'INVALID');
process.exit(ok ? 0 : 1);

/**
 * Usage / cost report (plan §15 "usage/cost metrics", docs/COST_MODEL.md): daily totals per
 * budgeted resource for the last N days, straight from `usage_counters`. Aggregates only — no user
 * keys leave the database. Run: `pnpm usage:report -- --days 14`. Reads .env like the other scripts.
 */
import { createDb } from '../packages/database/src/client.ts';
import { usageRepo } from '../packages/database/src/repositories.ts';
import { DAILY_BUDGET_LIMITS } from '../packages/observability/src/index.ts';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}
const daysArg = process.argv.indexOf('--days');
const days = Math.max(1, Math.min(365, daysArg > -1 ? Number(process.argv[daysArg + 1]) || 7 : 7));
const asJson = process.argv.includes('--json');
const to = new Date();
const from = new Date(to.getTime() - (days - 1) * 86_400_000);
const day = (d: Date) => d.toISOString().slice(0, 10);

const handle = createDb(url, { max: 1 });
try {
  const rows = await usageRepo(handle.db).dailyTotals(day(from), day(to));
  if (asJson) {
    console.log(JSON.stringify({ from: day(from), to: day(to), rows }, null, 2));
  } else {
    console.log(`usage ${day(from)} → ${day(to)} (UTC days)`);
    console.log('day         resource      total   keys  top-key  pro-budget');
    for (const r of rows) {
      const limit = (DAILY_BUDGET_LIMITS as Record<string, { pro: number } | undefined>)[
        r.resource
      ];
      console.log(
        `${r.day}  ${r.resource.padEnd(12)} ${String(r.total).padStart(7)} ${String(r.keys).padStart(6)}  ${(r.topShare * 100).toFixed(0).padStart(5)} %  ${limit ? String(limit.pro).padStart(7) : '      -'}`,
      );
    }
    const byResource = new Map<string, number>();
    for (const r of rows) byResource.set(r.resource, (byResource.get(r.resource) ?? 0) + r.total);
    console.log('totals:', [...byResource].map(([k, v]) => `${k}=${v}`).join(' ') || '(no usage)');
  }
} finally {
  await handle.close();
}

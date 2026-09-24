import 'server-only';
import { DAILY_BUDGET_LIMITS, type BudgetResource } from '@lightmap/observability';
import { usageRepo } from '@lightmap/database';
import { createHash } from 'node:crypto';
import { HttpError } from './http.ts';
import { getServices } from './services.ts';

/**
 * Two layers (plan §19, §29):
 *  1. A process-local sliding window per client key (cheap, protects the origin from bursts).
 *  2. A per-day budget per user/anonymous key in usage_counters (cost control; survives restarts).
 * Anonymous keys are a salted hash of IP + UA — never the raw IP.
 */
const windows = new Map<string, number[]>();

export function clientKey(req: Request, userId: string | null): string {
  if (userId) return `u:${userId}`;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const ua = req.headers.get('user-agent') ?? '';
  const salt = getServices().env.AUTH_SECRET ?? 'lightmap-anon';
  return `a:${createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex').slice(0, 24)}`;
}

export function checkBurst(key: string, limitPerMinute: number, now = Date.now()): void {
  const arr = (windows.get(key) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= limitPerMinute)
    throw new HttpError(429, 'rate_limited', 'Too many requests — slow down a little.');
  arr.push(now);
  windows.set(key, arr);
  if (windows.size > 10_000) {
    for (const [k, times] of windows) if (times.every((t) => now - t >= 60_000)) windows.delete(k);
  }
}

export async function chargeBudget(
  key: string,
  resource: BudgetResource,
  plan: 'anonymous' | 'free' | 'pro',
  amount = 1,
): Promise<void> {
  const { db } = getServices();
  const limit = DAILY_BUDGET_LIMITS[resource][plan];
  if (!db) return; // no persistence: burst limiter still applies
  const count = await usageRepo(db.db).increment(key, resource, amount);
  if (count > limit)
    throw new HttpError(
      429,
      'budget_exhausted',
      `Daily ${resource} budget reached for this ${plan === 'anonymous' ? 'device' : 'plan'}. It resets at midnight UTC.`,
    );
}

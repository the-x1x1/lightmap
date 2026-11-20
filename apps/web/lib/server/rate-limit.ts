import 'server-only';
import { DAILY_BUDGET_LIMITS, type BudgetResource } from '@lightmap/observability';
import { usageRepo } from '@lightmap/database';
import {
  ADDRESS_BURST_FACTOR,
  BurstExceeded,
  addressKey,
  anonymousKey,
  createBurstWindows,
} from './burst.ts';
import { HttpError } from './http.ts';
import { getServices } from './services.ts';

/**
 * Two layers (plan §19, §29):
 *  1. A process-local sliding window per client key (cheap, protects the origin from bursts).
 *  2. A per-day budget per user/anonymous key in usage_counters (cost control; survives restarts).
 * Anonymous keys are a salted hash of IP + UA — never the raw IP. The windows and the keys'
 * arithmetic are in burst.ts.
 */
const windows = createBurstWindows();
const salt = () => getServices().env.AUTH_SECRET ?? 'lightmap-anon';

export function clientKey(req: Request, userId: string | null): string {
  if (userId) return `u:${userId}`;
  return anonymousKey(req.headers, salt());
}

export function checkBurst(key: string, limitPerMinute: number, now = Date.now()): void {
  try {
    windows.check(key, limitPerMinute, now);
  } catch (error) {
    if (error instanceof BurstExceeded)
      throw new HttpError(429, 'rate_limited', 'Too many requests — slow down a little.');
    throw error;
  }
}

/**
 * A route's burst limit for this client, under `scope`: its own window and, when it is
 * anonymous, its address's at ADDRESS_BURST_FACTOR clients' worth - the window a client cannot
 * leave by changing its User-Agent. Returns the client's key (for its daily budget).
 */
export function checkClientBurst(
  req: Request,
  scope: string,
  userId: string | null,
  limitPerMinute: number,
): string {
  if (!userId) {
    const address = addressKey(req.headers, salt());
    if (address) checkBurst(`${scope}:${address}`, limitPerMinute * ADDRESS_BURST_FACTOR);
  }
  const key = clientKey(req, userId);
  checkBurst(`${scope}:${key}`, limitPerMinute);
  return key;
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

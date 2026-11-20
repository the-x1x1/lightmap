/**
 * The burst limiter's own arithmetic, apart from the server's services so it can be tested: the
 * sliding windows, and the keys a request is counted under.
 *
 * An anonymous client is counted twice. Under its own key - a salted hash of its address and its
 * User-Agent, which tells the browsers behind one address apart - and under its address alone,
 * at several clients' worth: the first key is the client's to change (any User-Agent it likes
 * gives it a fresh window), the second is not.
 */
import { createHash } from 'node:crypto';

/** Anonymous traffic from one address may use this many clients' worth of a burst limit. */
export const ADDRESS_BURST_FACTOR = 5;
/** Windows kept at most; beyond it the oldest go (a flood of new keys must not grow the map). */
export const MAX_WINDOWS = 10_000;

export class BurstExceeded extends Error {}

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 24);

/** The client's address as the proxy in front reports it, or null when nothing says. */
export function clientAddress(headers: Headers): string | null {
  const ip = (
    headers.get('x-forwarded-for')?.split(',')[0] ??
    headers.get('x-real-ip') ??
    ''
  ).trim();
  return ip.length > 0 && ip.length <= 64 ? ip : null;
}

/** The anonymous client's own key: address and User-Agent, salted and hashed - never the raw IP. */
export function anonymousKey(headers: Headers, salt: string): string {
  const ip = clientAddress(headers) ?? 'unknown';
  const ua = headers.get('user-agent') ?? '';
  return `a:${hash(`${salt}|${ip}|${ua}`)}`;
}

/**
 * The key of the address alone, or null when the address is unknown (nothing in front reports
 * it, as on a computer serving itself: every client would share one window). An IPv6 client
 * holds a whole /64, so its key is the network's.
 */
export function addressKey(headers: Headers, salt: string): string | null {
  const ip = clientAddress(headers);
  if (!ip) return null;
  const v6 = ip.includes(':') && !/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(ip);
  const net = v6 ? ip.toLowerCase().split(':').slice(0, 4).join(':') : ip.toLowerCase();
  return `n:${hash(`${salt}|address|${net}`)}`;
}

export interface BurstWindows {
  /** Counts one request under `key`; throws BurstExceeded past `limitPerMinute` in a minute. */
  check(key: string, limitPerMinute: number, now?: number): void;
  readonly size: number;
}

export function createBurstWindows(maxWindows = MAX_WINDOWS): BurstWindows {
  const windows = new Map<string, number[]>();
  let lastSweep = 0;
  return {
    check(key, limitPerMinute, now = Date.now()) {
      const arr = (windows.get(key) ?? []).filter((t) => now - t < 60_000);
      if (arr.length >= limitPerMinute) {
        windows.set(key, arr);
        throw new BurstExceeded();
      }
      arr.push(now);
      // Re-inserted, so the map's order is the order of last use.
      windows.delete(key);
      windows.set(key, arr);
      if (windows.size <= maxWindows) return;
      // Over the cap: the expired windows go first (at most one sweep a second - a sweep on
      // every request of a flood would be the flood's work done for it), then the least
      // recently used.
      if (now - lastSweep >= 1000) {
        lastSweep = now;
        for (const [k, times] of windows)
          if (times.every((t) => now - t >= 60_000)) windows.delete(k);
      }
      for (const k of windows.keys()) {
        if (windows.size <= maxWindows) break;
        windows.delete(k);
      }
    },
    get size() {
      return windows.size;
    },
  };
}

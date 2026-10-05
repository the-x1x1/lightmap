/**
 * "Return later as a shoot approaches and see the forecast become more specific" (plan §1,
 * item 10), on the project card: how far off the project's shoot date is, and when the
 * provider's forecast reaches it — "Shoot 17 Oct · in 12 days · forecast from 13 Oct". Civil
 * dates only (the shoot date is a date, the reader's "today" is a date), so no zone arithmetic.
 * Pure, unit-tested.
 */
import type { WeatherCapabilities } from '@lightmap/weather';

export interface ShootCountdown {
  /** Civil days from today to the shoot date: negative once it has passed. */
  days: number;
  /** "in 12 days", "tomorrow", "today", "yesterday", "3 days ago". */
  when: string;
  /**
   * Where the forecast stands for that date: within the reliable horizon, in the extended range,
   * or still ahead of the provider's reach — then the civil date the forecast opens on.
   */
  forecast:
    | { kind: 'available' }
    | { kind: 'extended' }
    | { kind: 'ahead'; opensOn: string; inDays: number }
    | { kind: 'past' }
    | null;
  /** The card's line, e.g. "in 12 days · forecast from 13 Oct". */
  text: string;
}

const DAY_MS = 86_400_000;

function utcDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // A date that does not exist (30 February) rolls over in Date.UTC; the round trip catches it.
  return Number.isNaN(t) || isoFromUtcDay(t) !== iso ? null : t;
}

function isoFromUtcDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** "13 Oct" — the short civil date for a card line; "13 Oct 2027" with `withYear`. */
export function shortCivilDate(iso: string, withYear = false): string {
  const t = utcDay(iso);
  if (t === null) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
    .format(new Date(t))
    .replace(/ Sept\b/, ' Sep');
}

/** Whole civil days from `today` to `shootDate`, both YYYY-MM-DD; null when either is malformed. */
export function civilDaysUntil(shootDate: string, today: string): number | null {
  const a = utcDay(shootDate);
  const b = utcDay(today);
  if (a === null || b === null) return null;
  return Math.round((a - b) / DAY_MS);
}

export function describeWhen(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${-days} days ago`;
  return `in ${days} days`;
}

/**
 * The countdown and the forecast's standing for the shoot date. The provider's horizons are in
 * hours from "now"; a shoot `d` days ahead is inside the horizon when its day starts within it,
 * so the day count is compared with the horizon floored to whole days (16 and 7 for Open-Meteo).
 * `caps` null (no provider known yet) leaves the forecast part out.
 */
export function shootCountdown(
  shootDate: string,
  today: string,
  caps: Pick<WeatherCapabilities, 'maxHorizonHours' | 'reliableHorizonHours'> | null,
): ShootCountdown | null {
  const days = civilDaysUntil(shootDate, today);
  if (days === null) return null;
  const when = describeWhen(days);
  let forecast: ShootCountdown['forecast'] = null;
  if (caps) {
    const reach = Math.floor(caps.maxHorizonHours / 24);
    const reliable = Math.floor(caps.reliableHorizonHours / 24);
    if (days < 0) forecast = { kind: 'past' };
    else if (days <= reliable) forecast = { kind: 'available' };
    else if (days <= reach) forecast = { kind: 'extended' };
    else {
      const inDays = days - reach;
      const todayUtc = utcDay(today)!;
      forecast = { kind: 'ahead', opensOn: isoFromUtcDay(todayUtc + inDays * DAY_MS), inDays };
    }
  }
  const tail =
    forecast === null || forecast.kind === 'past'
      ? ''
      : forecast.kind === 'available'
        ? ' · forecast available'
        : forecast.kind === 'extended'
          ? ' · extended forecast available'
          : forecast.inDays === 1
            ? ' · forecast from tomorrow'
            : ` · forecast from ${shortCivilDate(forecast.opensOn)}`;
  return { days, when, forecast, text: `${when}${tail}` };
}

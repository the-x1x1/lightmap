/**
 * Playing the day (plan §1 "scrub the clock forward and watch the scene change", without the
 * dragging): the timeline advances by itself at a chosen pace — day-minutes per real second —
 * and wraps at the end of the civil day so a sunset can be watched again. Pure helpers; the hook
 * drives the store with them.
 */

/** Day-minutes per real second: a golden hour in half a minute, a day in 2½ minutes, or in 24 s. */
export const PLAY_RATES = [2, 10, 60] as const;
export type PlayRate = (typeof PLAY_RATES)[number];
export const DEFAULT_PLAY_RATE: PlayRate = 10;
/** Store updates at most this often while playing; the renderer applies each one cheaply. */
export const PLAY_TICK_MS = 50;

export function nextRate(rate: PlayRate): PlayRate {
  const i = PLAY_RATES.indexOf(rate);
  return PLAY_RATES[(i + 1) % PLAY_RATES.length] ?? DEFAULT_PLAY_RATE;
}

/** "10 min/s" — the pace as the button shows it. */
export function describeRate(rate: PlayRate): string {
  return `${rate} min/s`;
}

/**
 * Where the clock stands after `elapsedMs` of real time at `rate`, from a fractional `minutes`;
 * wraps past the day's last minute (`total`, 1440 on an ordinary day) back to midnight. Fractions
 * are kept so a slow pace still progresses between ticks; the caller rounds for the store.
 */
export function advance(minutes: number, elapsedMs: number, rate: number, total = 1440): number {
  if (!(elapsedMs > 0) || !(rate > 0) || !(total > 0)) return minutes;
  const next = minutes + (elapsedMs / 1000) * rate;
  return ((next % total) + total) % total;
}

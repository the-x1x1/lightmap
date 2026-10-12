/**
 * The field view's clock line: how far the planned instant is from now, in the words a
 * photographer standing at the spot wants — "in 1 h 12 min", "32 min ago", "in 2 d 5 h" — or
 * null when the planner sits on the present (within a minute and a half), when the marks show
 * the sky as it is. Pure, unit-tested.
 */

/** Closer than this to now, the planner counts as live. */
export const LIVE_WITHIN_MS = 90_000;

export function describePlannedOffset(
  plannedMs: number,
  nowMs: number,
  liveWithinMs = LIVE_WITHIN_MS,
): string | null {
  const d = plannedMs - nowMs;
  if (Math.abs(d) < liveWithinMs) return null;
  const minutes = Math.round(Math.abs(d) / 60_000);
  let text: string;
  if (minutes < 60) text = `${minutes} min`;
  else if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    text = m === 0 ? `${h} h` : `${h} h ${m} min`;
  } else {
    const days = Math.floor(minutes / (24 * 60));
    const h = Math.floor((minutes % (24 * 60)) / 60);
    text = h === 0 ? `${days} d` : `${days} d ${h} h`;
  }
  return d > 0 ? `in ${text}` : `${text} ago`;
}

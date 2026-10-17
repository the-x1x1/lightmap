/**
 * A coordinate to a thousandth of a degree (~100 m): for the day's events and the scans over
 * nights and seasons, which do not change across a walk's steps but would rerun on each.
 */
export function quantizeDeg(deg: number): number {
  return Math.round(deg * 1000) / 1000;
}

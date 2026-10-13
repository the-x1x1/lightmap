/**
 * Frame-rate samples for the quality governor that measure the machine, not the demand.
 *
 * The scene renders on demand: while idle it draws only when something asks (a tile arriving,
 * a clock tick), and a hidden or throttled page draws rarely or not at all. Frames per wall
 * clock second then reads as a slow machine — a tile stream drew 15 frames a second on a PC
 * that renders in 7 ms, and the governor stepped down to its lowest rung. Only frames drawn
 * back to back while the camera moves are timed: during an orbit, a flight or a drag every
 * animation frame draws, so their spacing is what the machine can do.
 */

/** Intervals in a window below which no sample is emitted (too little continuous motion). */
export const MIN_INTERVALS_FOR_SAMPLE = 12;
/** A gap longer than this between two moving frames is a pause, not a slow frame. */
export const MAX_FRAME_GAP_MS = 250;

export class FrameRateSampler {
  private last: number | null = null;
  private lastMoving = false;
  private sumMs = 0;
  private count = 0;
  private windowStart: number | null = null;
  private readonly windowMs: number;
  private readonly minIntervals: number;
  private readonly maxGapMs: number;

  constructor(
    windowMs = 1000,
    minIntervals = MIN_INTERVALS_FOR_SAMPLE,
    maxGapMs = MAX_FRAME_GAP_MS,
  ) {
    this.windowMs = windowMs;
    this.minIntervals = minIntervals;
    this.maxGapMs = maxGapMs;
  }

  /**
   * One rendered frame at time `t` (ms), with whether the camera moved since the frame before.
   * Returns frames per second when a window of continuous motion closes, else null.
   */
  frame(t: number, moving: boolean): number | null {
    const prev = this.last;
    const prevMoving = this.lastMoving;
    this.last = t;
    this.lastMoving = moving;
    if (prev !== null && moving && prevMoving) {
      const dt = t - prev;
      if (dt > 0 && dt <= this.maxGapMs) {
        this.sumMs += dt;
        this.count++;
        this.windowStart ??= prev;
      }
    }
    if (this.windowStart === null || t - this.windowStart < this.windowMs) return null;
    const fps = this.count >= this.minIntervals ? (1000 * this.count) / this.sumMs : null;
    this.sumMs = 0;
    this.count = 0;
    this.windowStart = null;
    return fps;
  }
}

/**
 * The viewpoint's keyboard and wheel input as pure functions (unit-tested): how far a held set
 * of W A S D keys walks per step, and how much a wheel event zooms the lens.
 */

/** Walking speed from the viewpoint, metres a second (a brisk walk; Shift: five times). */
export const WALK_MPS = 6;
/** The walk's step interval; the renderer glides the eye between steps. */
export const WALK_TICK_MS = 100;

/**
 * One walk step for the keys held (by `KeyboardEvent.code`): metres forward and to the right,
 * diagonals at the same speed as straight lines; null when the keys cancel out or none is held.
 */
export function walkStep(
  held: ReadonlySet<string>,
  running: boolean,
): { forwardM: number; rightM: number } | null {
  const stride = (running ? 5 : 1) * WALK_MPS * (WALK_TICK_MS / 1000);
  const forward = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
  const right = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
  if (forward === 0 && right === 0) return null;
  const n = Math.hypot(forward, right);
  return { forwardM: (forward / n) * stride, rightM: (right / n) * stride };
}

/**
 * The factor a wheel event scales the field of view by: exponential in how far it scrolled (a
 * trackpad's many small deltas zoom smoothly, a mouse notch of ~100 px about 8 %), lines and pages
 * converted, at most ±30 % an event. macOS reports a mouse-wheel notch as a multiple of
 * 4.000244140625 px, which a trackpad never is: that counts as a full notch.
 */
export function wheelZoomFactor(e: { deltaY: number; deltaMode: number }): number {
  const notch = e.deltaMode === 0 && e.deltaY !== 0 && e.deltaY % 4.000244140625 === 0;
  const px = notch
    ? Math.sign(e.deltaY) * 100
    : e.deltaMode === 1
      ? e.deltaY * 33
      : e.deltaMode === 2
        ? e.deltaY * 400
        : e.deltaY;
  return Math.exp(Math.max(-0.3, Math.min(0.3, px * 0.0008)));
}

/** The lens's limits (the store clamps to the same). */
export const FOV_MIN_DEG = 5;
export const FOV_MAX_DEG = 120;
/** How quickly a wheel zoom eases to where the wheel sent it, ms (time constant). */
export const ZOOM_EASE_TAU_MS = 70;

/**
 * One frame of a wheel zoom easing toward its goal: exponential in the ratio of the two fields
 * of view (so 10° to 20° takes as long as 60° to 120°), landing on the goal once within 0.2 %. A
 * mouse notch's 8 % step then opens over a few frames instead of in one, and a trackpad's stream
 * of small deltas reads as one continuous zoom.
 */
export function easeFovToward(
  currentDeg: number,
  goalDeg: number,
  dtMs: number,
): { fovDeg: number; done: boolean } {
  const goal = Math.max(FOV_MIN_DEG, Math.min(FOV_MAX_DEG, goalDeg));
  if (!(currentDeg > 0) || !(dtMs >= 0)) return { fovDeg: goal, done: true };
  const k = Math.exp(-dtMs / ZOOM_EASE_TAU_MS);
  const next = goal * Math.pow(currentDeg / goal, k);
  if (Math.abs(next / goal - 1) < 0.002) return { fovDeg: goal, done: true };
  return { fovDeg: next, done: false };
}

/** Where a wheel event sends the zoom: from the goal still being eased to, if any. */
export function wheelZoomGoal(
  currentDeg: number,
  goalDeg: number | null,
  e: { deltaY: number; deltaMode: number },
): number {
  return Math.max(FOV_MIN_DEG, Math.min(FOV_MAX_DEG, (goalDeg ?? currentDeg) * wheelZoomFactor(e)));
}

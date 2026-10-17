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

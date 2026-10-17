/**
 * The Moon's disc for the viewpoint's sky: its phase drawn on a small canvas (the lit part on
 * the right, turned toward the Sun by the host), and how strongly it shows against a day or night
 * sky. Cesium's own Moon is lit by Cesium's Sun, not the planner's, and drew a black disc; this
 * one is drawn from the planner's Moon. Pure apart from the 2D context it is handed.
 */

/** The terminator's half-width as a share of the radius: 1 at new and full, 0 at the quarters. */
export function terminatorHalfWidth(illuminatedFraction: number): number {
  const f = Math.max(0, Math.min(1, illuminatedFraction));
  return Math.abs(1 - 2 * f);
}

/** How the disc shows: pale in a daylit sky, stronger in twilight, full at night. */
export function moonDiscOpacity(sunElevationDeg: number): number {
  if (sunElevationDeg >= 0) return 0.55;
  if (sunElevationDeg <= -12) return 1;
  return 0.55 + 0.45 * (-sunElevationDeg / 12);
}

/** The part of a 2D context the phase drawing uses. */
export interface PhaseContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    a0: number,
    a1: number,
    ccw?: boolean,
  ): void;
  closePath(): void;
  fill(): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
}

/**
 * The phase on a `size` × `size` canvas: a faint earthshine disc, then the lit part bounded by
 * the right-hand limb and the terminator (an ellipse of half-width `terminatorHalfWidth`), bulging
 * right for a crescent and left for a gibbous Moon.
 */
export function drawMoonPhase(ctx: PhaseContext, size: number, illuminatedFraction: number): void {
  const c = size / 2;
  const r = size / 2 - 1;
  const f = Math.max(0, Math.min(1, illuminatedFraction));
  ctx.clearRect(0, 0, size, size);
  // Earthshine: the dark side barely there.
  ctx.fillStyle = 'rgba(150, 160, 180, 0.12)';
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  if (f < 0.005) return;
  ctx.fillStyle = 'rgb(236, 232, 220)';
  ctx.beginPath();
  // The lit limb: the right half of the disc, top to bottom.
  ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2, false);
  // Back up along the terminator: inside the right half for a crescent, out into the left half
  // for a gibbous Moon.
  const rx = r * terminatorHalfWidth(f);
  ctx.ellipse(c, c, Math.max(0.01, rx), r, 0, Math.PI / 2, -Math.PI / 2, f < 0.5);
  ctx.closePath();
  ctx.fill();
}

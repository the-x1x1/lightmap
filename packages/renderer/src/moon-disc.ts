/**
 * The Moon's disc for the viewpoint's sky: its phase drawn on a small canvas (the lit part on
 * the right, turned toward the Sun by the host), and how strongly it shows against a day or night
 * sky. Cesium's own Moon is lit by Cesium's Sun, not the planner's, and drew a black disc; this
 * one is drawn from the planner's Moon. Pure apart from the 2D context it is handed.
 */
import { colorTemperatureKelvin, kelvinToRgb } from '@lightmap/weather';
import { extinctionMag } from './planet-points.ts';

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

/**
 * The Moon's brightness against the full Moon's, from its illuminated fraction: the phase angle
 * from the fraction (k = (1 + cos psi) / 2), then the Astronomical Almanac's lunar magnitude
 * (-12.73 + 0.026 |psi| + 4e-9 psi^4). A quarter Moon is about a tenth of a full one.
 */
export function moonBrightnessVsFull(illuminatedFraction: number): number {
  const k = Math.max(0, Math.min(1, illuminatedFraction));
  const psi = (Math.acos(2 * k - 1) * 180) / Math.PI;
  const dm = 0.026 * psi + 4e-9 * psi ** 4;
  return 10 ** (-0.4 * dm);
}

/**
 * How strongly the Moon lights the haze and thin cloud around it (the grade's aureole), 0-1:
 * its brightness against the full Moon's, in a sky dark enough for moonlight to tell (none until
 * the Sun is 2 deg down, all of it from 10 deg down), dimmed by the air when the Moon is low
 * (`extinctionMag`, as for the planets: a Moon on the horizon lights little of the sky).
 */
export function moonGlowStrength(
  illuminatedFraction: number,
  sunElevationDeg: number,
  moonElevationDeg = 90,
): number {
  const t = Math.max(0, Math.min(1, (-2 - sunElevationDeg) / 8));
  const dark = t * t * (3 - 2 * t);
  const air = 10 ** (-0.4 * extinctionMag(moonElevationDeg));
  return moonBrightnessVsFull(illuminatedFraction) * dark * air;
}

/**
 * The disc's colour where it stands: moonlight is sunlight through the same air, so a low Moon
 * takes the low Sun's colour (the planner's direct-light curve, 2,900 K on the horizon to neutral
 * from 20 deg up) and is dimmed by the air it shines through (`extinctionMag`), kept to at least
 * about half so the rising Moon still reads on a screen - the orange disc over a skyline that a
 * moonrise shot is planned around. White, full strength, high in the sky.
 */
export function moonDiscTint(elevationDeg: number): [number, number, number] {
  const [r, g, b] = discTint(elevationDeg);
  const dim = Math.max(0.55, 10 ** (-0.4 * extinctionMag(elevationDeg)));
  return [r * dim, g * dim, b * dim];
}

/**
 * The colour of direct light from a body at an elevation, brightest channel 1: the planner's
 * direct-light curve (2,900 K on the horizon, 3,800 K at 5 deg, neutral from 20 deg) - the Sun's
 * own colour as it sinks, and the Moon's.
 */
export function directLightTint(elevationDeg: number): [number, number, number] {
  const [r, g, b] = kelvinToRgb(colorTemperatureKelvin(Math.max(0, elevationDeg)));
  const peak = Math.max(r, g, b, 1e-3);
  return [r / peak, g / peak, b / peak];
}

/**
 * The colour of a disc seen low through the air (the Sun's or the Moon's), brightest channel 1.
 * The light-curve colour (`directLightTint`) is the light the scene receives, mixed with the
 * sky's; the disc itself is the beam alone and redder: the curve's tint is deepened under 6 deg
 * up, to about (1, 0.5, 0.18) on the horizon - a 2,000 K disc.
 */
export function discTint(elevationDeg: number): [number, number, number] {
  const [r, g, b] = directLightTint(elevationDeg);
  const k = 1 + 1.2 * (1 - Math.max(0, Math.min(1, elevationDeg / 6)));
  return [r ** k, g ** k, b ** k];
}

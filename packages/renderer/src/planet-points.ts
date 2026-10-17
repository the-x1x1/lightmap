/**
 * How the naked-eye planets are drawn in the viewpoint's sky: a point whose brightness follows
 * the planet's magnitude and what the twilight lets through. The grade shader draws them (the
 * star field has none), after it has faded the stars and before the cloud decks, so cloud covers
 * them and a ridge hides them.
 */
import {
  PLANET_GLARE_DEG,
  extinctionMag,
  planetVisible,
  skyLimitingMagnitude,
} from '@lightmap/astronomy';

export { PLANET_GLARE_DEG, extinctionMag, skyLimitingMagnitude };

export interface PlanetPoint {
  /** Peak brightness of the point in the display's 0-1 range (the core can saturate). */
  peak: number;
  /** Gaussian radius of the point, CSS pixels: a bright planet draws a little larger. */
  sigmaPx: number;
}

/**
 * The point a planet of `magnitude` draws at a Sun elevation, or null when the sky hides it. It
 * fades in over a magnitude and a half past the sky's limit, and a brighter planet's point is
 * larger and saturates, as a bright planet does in a photograph.
 */
export function planetPoint(magnitude: number, sunElevationDeg: number): PlanetPoint | null {
  const margin = skyLimitingMagnitude(sunElevationDeg) - magnitude;
  if (!(margin > 0)) return null;
  const visible = Math.min(1, margin / 1.5);
  // Linear flux against a first-magnitude star, which draws at about 0.45 at its core.
  const flux = 10 ** (-0.4 * (magnitude - 1));
  const peak = Math.min(1, 0.45 * Math.sqrt(flux)) * visible;
  const sigmaPx = 0.75 + 0.22 * Math.max(0, 1 - magnitude);
  return { peak, sigmaPx };
}

/**
 * The point a planet draws where it stands, or null when it cannot be seen: below the horizon,
 * in the Sun's glare, or too faint for the sky once the air low down has dimmed it. The 3D sky
 * and the planner's planets line share this rule.
 */
export function planetPointInSky(
  p: { magnitude: number; elevationDeg: number; elongationDeg: number },
  sunElevationDeg: number,
): PlanetPoint | null {
  if (!planetVisible(p, sunElevationDeg)) return null;
  return planetPoint(p.magnitude + extinctionMag(p.elevationDeg), sunElevationDeg);
}

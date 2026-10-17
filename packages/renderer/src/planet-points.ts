/**
 * How the naked-eye planets are drawn in the viewpoint's sky: a point whose brightness follows
 * the planet's magnitude and what the twilight lets through. The grade shader draws them (the
 * star field has none), after it has faded the stars and before the cloud decks, so cloud covers
 * them and a ridge hides them.
 */

/**
 * The faintest magnitude the sky shows at a Sun elevation: Venus only, faintly, in full day
 * (-4); Venus plainly by sunset (-3) and Jupiter soon after (-1 with the Sun 3 deg down);
 * first-magnitude stars by the end of civil twilight; the naked-eye limit (6) in astronomical
 * night. Interpolated between those points.
 */
export function skyLimitingMagnitude(sunElevationDeg: number): number {
  const pts: Array<[number, number]> = [
    [10, -4],
    [0, -3],
    [-3, -1],
    [-6, 1.5],
    [-9, 3.5],
    [-12, 4.8],
    [-18, 6],
  ];
  const el = sunElevationDeg;
  if (el >= 10) return -4;
  for (let i = 1; i < pts.length; i++) {
    const [e1, m1] = pts[i - 1]!;
    const [e2, m2] = pts[i]!;
    if (el >= e2) return m1 + ((el - e1) / (e2 - e1)) * (m2 - m1);
  }
  return 6;
}

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
 * How many magnitudes the air dims a point at an elevation, against the zenith: 0.25 mag per
 * air mass (a clear sea-level sky), the air mass by Kasten and Young (1989). A planet 2 deg up
 * is about 4.6 mag fainter than overhead; at the horizon, about 9.
 */
export function extinctionMag(elevationDeg: number): number {
  const h = Math.max(-0.5, elevationDeg);
  const airMass = 1 / (Math.sin(h * (Math.PI / 180)) + 0.50572 * (h + 6.07995) ** -1.6364);
  return Math.max(0, 0.25 * (airMass - 1));
}

/** Planets this close to the Sun are lost in its glare, whatever their brightness. */
export const PLANET_GLARE_DEG = 10;

/**
 * The point a planet draws where it stands, or null when it cannot be seen: below the horizon,
 * in the Sun's glare, or too faint for the sky once the air low down has dimmed it. The 3D sky
 * and the planner's planets line share this rule.
 */
export function planetPointInSky(
  p: { magnitude: number; elevationDeg: number; elongationDeg: number },
  sunElevationDeg: number,
): PlanetPoint | null {
  if (!(p.elevationDeg > 0) || !(p.elongationDeg > PLANET_GLARE_DEG)) return null;
  return planetPoint(p.magnitude + extinctionMag(p.elevationDeg), sunElevationDeg);
}

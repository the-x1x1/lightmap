/**
 * What the naked eye can see of a point in the sky: the faintest magnitude the twilight shows,
 * the air's dimming low down, and the Sun's glare. Shared by the planets' place in the 3D sky
 * (renderer `planetPointInSky`), the planets line and the Light finder.
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
 * Whether a planet can be seen where it stands: above the horizon, clear of the Sun's glare,
 * and brighter (once the air low down has dimmed it) than the faintest the sky shows.
 */
export function planetVisible(
  p: { magnitude: number; elevationDeg: number; elongationDeg: number },
  sunElevationDeg: number,
): boolean {
  if (!(p.elevationDeg > 0) || !(p.elongationDeg > PLANET_GLARE_DEG)) return false;
  return p.magnitude + extinctionMag(p.elevationDeg) < skyLimitingMagnitude(sunElevationDeg);
}

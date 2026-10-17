/**
 * The planets line in the Sun & Moon details: which naked-eye planets can be seen at the planned
 * time, where and how bright, brightest first, by the rule the 3D sky draws them by
 * (`planetPointInSky`: above the horizon, clear of the Sun's glare, bright enough for the sky
 * once the air low down has dimmed it). With none to see it says which are up but lost, and to
 * what. A clear sky is assumed: cloud is the forecast's to say.
 */
import type { PlanetPosition } from '@lightmap/astronomy';
import { compassLabel } from '@lightmap/geospatial';

const NAMES: Record<PlanetPosition['name'], string> = {
  mercury: 'Mercury',
  venus: 'Venus',
  mars: 'Mars',
  jupiter: 'Jupiter',
  saturn: 'Saturn',
};

/** Whether a planet can be seen at a Sun elevation (renderer `planetPointInSky`). */
export type InSky = (p: PlanetPosition, sunElevationDeg: number) => unknown;

/** The planets one can see now, brightest first; empty when none can be seen. */
export function visiblePlanets(
  planets: readonly PlanetPosition[],
  sunElevationDeg: number,
  inSky: InSky,
): PlanetPosition[] {
  return planets
    .filter((p) => inSky(p, sunElevationDeg) !== null)
    .sort((a, b) => a.magnitude - b.magnitude);
}

function names(list: readonly PlanetPosition[]): string {
  const n = list.map((p) => NAMES[p.name]);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1] ?? ''}` : (n[0] ?? '');
}

/**
 * "Venus W 28° (mag −4.2), Jupiter ESE 12° (−2.1)"; with none to see, "none visible", and which
 * are up but lost: "none visible (Jupiter and Saturn up, in daylight)".
 */
export function describePlanets(
  planets: readonly PlanetPosition[],
  sunElevationDeg: number,
  inSky: InSky,
): string {
  const seen = visiblePlanets(planets, sunElevationDeg, inSky);
  if (seen.length === 0) {
    const up = planets.filter((p) => p.elevationDeg > 0);
    if (up.length === 0) return 'none visible (all below the horizon)';
    const glare = up.filter((p) => p.elongationDeg <= 10);
    const why =
      glare.length === up.length
        ? "in the Sun's glare"
        : sunElevationDeg > -0.833
          ? 'in daylight'
          : sunElevationDeg > -6
            ? 'in the bright twilight'
            : 'too low in the haze';
    return `none visible (${names(up)} up, ${why})`;
  }
  return seen
    .map((p, i) => {
      const mag = `${p.magnitude < 0 ? '−' : '+'}${Math.abs(p.magnitude).toFixed(1)}`;
      return `${NAMES[p.name]} ${compassLabel(p.azimuthDeg)} ${Math.round(p.elevationDeg)}° (${i === 0 ? 'mag ' : ''}${mag})`;
    })
    .join(', ');
}

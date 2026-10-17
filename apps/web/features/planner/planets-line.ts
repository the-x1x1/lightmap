/**
 * The planets line in the Sun & Moon details: which naked-eye planets stand above the horizon at
 * the planned time, where and how bright, brightest first. One out of the Sun's glare and bright
 * enough for the sky is named plainly; one up but lost in daylight or twilight is left out, so
 * the line says what can be seen and framed.
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

/** The faintest magnitude the sky shows at a Sun elevation (renderer `skyLimitingMagnitude`). */
export type LimitingMagnitude = (sunElevationDeg: number) => number;

/** The planets one can see now, brightest first; empty when none is up and visible. */
export function visiblePlanets(
  planets: readonly PlanetPosition[],
  sunElevationDeg: number,
  limit: LimitingMagnitude,
): PlanetPosition[] {
  const faintest = limit(sunElevationDeg);
  return planets
    .filter((p) => p.elevationDeg > 0 && p.elongationDeg > 10 && p.magnitude < faintest)
    .sort((a, b) => a.magnitude - b.magnitude);
}

/** "Venus W 28° (mag −4.2), Jupiter ESE 12° (−2.1)", or null when none can be seen. */
export function describePlanets(seen: readonly PlanetPosition[]): string | null {
  if (seen.length === 0) return null;
  return seen
    .map((p, i) => {
      const mag = `${p.magnitude < 0 ? '−' : '+'}${Math.abs(p.magnitude).toFixed(1)}`;
      return `${NAMES[p.name]} ${compassLabel(p.azimuthDeg)} ${Math.round(p.elevationDeg)}° (${i === 0 ? 'mag ' : ''}${mag})`;
    })
    .join(', ');
}

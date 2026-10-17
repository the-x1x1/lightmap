/** The Light finder's bodies by name, as its text, its calendar and its panel say them. */
import type { CelestialBody } from '@lightmap/astronomy';

const NAMES: Record<CelestialBody, string> = {
  sun: 'Sun',
  moon: 'Moon',
  core: 'Milky Way core',
  venus: 'Venus',
  jupiter: 'Jupiter',
};

export function bodyLabel(body: CelestialBody): string {
  return NAMES[body];
}

/** Whether the body is a point on the sky (the core, a planet), not a disc with a limb. */
export function isPointBody(body: CelestialBody): boolean {
  return body === 'core' || body === 'venus' || body === 'jupiter';
}

/**
 * City glow at night, estimated from the bundled urban areas (Natural Earth's built-up extents,
 * `urban-areas.ts`): how much the towns around a place brighten its sky, and from which side.
 * The Milky Way core verdict is geometry (Sun depth, Moon, altitude); a photographer standing in
 * Manhattan or ten kilometres outside Las Vegas also needs to hear that the core will be washed
 * out, or that the glow sits low in one quarter of the sky.
 *
 * Walker's law: the sky glow a town casts falls with the distance to it to the power -2.5 and
 * grows with its population. Built-up area stands in for population here (the light a town sheds
 * follows its lit ground more closely than its census), so each polygon adds
 * `area_km2 * max(d_km, 2)^-2.5`, with d to its nearest edge (0 inside it). The sum is graded
 * against places of known sky (Bortle class from published dark-sky surveys):
 * - Times Square, Hollywood, central Honolulu: inside a built-up area - a city sky;
 * - a suburb or a few km from a large city: >= 1 - suburban, the core faint at best;
 * - 0.15-1: a glow on the horizon toward the town, the core visible above it;
 * - 0.03-0.15: a faint dome on the horizon;
 * - below: no mapped town lights the sky (Cherry Springs, Big Bend, Mauna Kea).
 *
 * An estimate, and labelled one: Natural Earth maps the larger towns only (villages, resorts,
 * stadiums, greenhouses and gas flares are not in it), it is from 2002-2003 satellite data, and
 * haze, snow cover and the town's own lighting all shift the real figure. Pure and unit-tested.
 */
import type { UrbanPolygon } from './urban-areas.ts';

export type SkyGlowGrade = 'city' | 'suburban' | 'horizon' | 'faint' | 'dark';

export interface SkyGlow {
  grade: SkyGlowGrade;
  /** The summed Walker index (area km^2 x km^-2.5); 0 with no town in reach. */
  index: number;
  /** Bearing (degrees from true north) of the strongest glow, null when there is none. */
  bearingDeg: number | null;
  /** Distance to the edge of the town that glows most, km (0 inside it); null with none. */
  distanceKm: number | null;
}

/** Towns further than this add nothing worth naming (index < 0.01 for the largest metros). */
export const SKY_GLOW_REACH_KM = 250;

const R_KM = 6371;
const RAD = Math.PI / 180;

/** Grade thresholds on the Walker index (see the module comment). */
const SUBURBAN = 1;
const HORIZON = 0.15;
const FAINT = 0.03;

/**
 * The glow over `latitude`/`longitude` from the polygons around it (pass every polygon whose
 * cell lies within `SKY_GLOW_REACH_KM`; further ones are ignored).
 */
export function skyGlowAt(
  latitude: number,
  longitude: number,
  polygons: readonly UrbanPolygon[],
): SkyGlow {
  // A local plane in km around the place: ample for a glow estimate over a few hundred km.
  const kx = R_KM * RAD * Math.cos(latitude * RAD);
  const ky = R_KM * RAD;
  const toLocal = ([lon, lat]: [number, number]): [number, number] => {
    let dLon = lon - longitude;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    return [dLon * kx, (lat - latitude) * ky];
  };
  let index = 0;
  let best = 0;
  let bearingDeg: number | null = null;
  let distanceKm: number | null = null;
  let inside = false;
  for (const poly of polygons) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    const ring = outer.map(toLocal);
    // Quick reject on the ring's box.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const boxD = Math.hypot(Math.max(minX, 0, -maxX), Math.max(minY, 0, -maxY));
    if (boxD > SKY_GLOW_REACH_KM) continue;
    const area =
      Math.abs(ringArea(ring)) -
      poly.slice(1).reduce((s, hole) => s + Math.abs(ringArea(hole.map(toLocal))), 0);
    if (area <= 0) continue;
    const contains = inRing(ring, 0, 0) && !poly.slice(1).some((h) => inRing(h.map(toLocal), 0, 0));
    const [d, cx, cy] = contains ? [0, 0, 0] : nearestOnRing(ring);
    if (d > SKY_GLOW_REACH_KM) continue;
    const g = area * Math.max(d, 2) ** -2.5;
    index += g;
    if (contains) inside = true;
    if (g > best) {
      best = g;
      distanceKm = d;
      bearingDeg = contains ? null : (Math.atan2(cx, cy) / RAD + 360) % 360;
    }
  }
  const grade: SkyGlowGrade = inside
    ? 'city'
    : index >= SUBURBAN
      ? 'suburban'
      : index >= HORIZON
        ? 'horizon'
        : index >= FAINT
          ? 'faint'
          : 'dark';
  if (grade === 'dark') return { grade, index, bearingDeg: null, distanceKm: null };
  return { grade, index, bearingDeg, distanceKm };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** One line for the night section, e.g. "a glow on the horizon to the SW (town 40 km off)". */
export function describeSkyGlow(g: SkyGlow): string {
  const side = g.bearingDeg === null ? '' : ` to the ${COMPASS[Math.round(g.bearingDeg / 45) % 8]}`;
  const off = g.distanceKm === null ? '' : ` (built-up area ${Math.round(g.distanceKm)} km off)`;
  switch (g.grade) {
    case 'city':
      return 'city sky - inside a built-up area the core is washed out';
    case 'suburban':
      return `bright suburban sky${side}${off}: the core faint at best`;
    case 'horizon':
      return `a glow on the horizon${side}${off}; the core shows above it`;
    case 'faint':
      return `a faint dome low${side}${off}`;
    case 'dark':
      return 'no mapped town lights the sky';
  }
}

/** Shoelace area of a ring in the local plane (km^2, signed). */
function ringArea(ring: readonly (readonly [number, number])[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as readonly [number, number];
    const b = ring[i] as readonly [number, number];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function inRing(ring: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as readonly [number, number];
    const [xj, yj] = ring[j] as readonly [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The nearest point of a ring to the origin: [distance, x, y]. */
function nearestOnRing(ring: readonly (readonly [number, number])[]): [number, number, number] {
  let best: [number, number, number] = [Infinity, 0, 0];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j] as readonly [number, number];
    const [bx, by] = ring[i] as readonly [number, number];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < best[0]) best = [d, px, py];
  }
  return best;
}

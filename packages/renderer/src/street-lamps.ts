import type { StreetLine } from './vector-cover.ts';

const M_PER_DEG_LAT = 111_320;

/**
 * Where the street lamps stand along a town's roads (OpenStreetMap's, `streetLinesFromTile`): one
 * every `spacingM` along each road, set back half the road's width plus a metre from its centre
 * line and alternating sides, as lamp posts are staggered along most streets. Paths and tracks
 * get none (most are unlit), nor service roads (yards and car parks: lit, but not as a street
 * is). The spacing runs on along a line across its vertices, so a curving street keeps its
 * rhythm. At most `max` lamps, the nearest to (`centreLon`, `centreLat`) kept when there are
 * more. With `lit` (`builtUpTest`), only where it says the road runs through a built-up place:
 * an open road is dark.
 */
export function streetLampPositions(
  lines: readonly StreetLine[],
  spacingM = 35,
  max = 6000,
  centreLon?: number,
  centreLat?: number,
  lit?: (lon: number, lat: number) => boolean,
): [number, number][] {
  const out: [number, number][] = [];
  for (const l of lines) {
    if (l.kind !== 'road' || l.widthM < 5) continue;
    const setBack = l.widthM / 2 + 1;
    let carry = spacingM / 2;
    let side = 1;
    for (let i = 0; i + 1 < l.points.length; i++) {
      const [lon0, lat0] = l.points[i]!;
      const [lon1, lat1] = l.points[i + 1]!;
      const mPerDegLon = M_PER_DEG_LAT * Math.cos(((lat0 + lat1) / 2) * (Math.PI / 180));
      const dx = (lon1 - lon0) * mPerDegLon;
      const dy = (lat1 - lat0) * M_PER_DEG_LAT;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = -dy / len;
      const ny = dx / len;
      let s = carry;
      for (; s <= len; s += spacingM) {
        const ex = (dx * s) / len + nx * setBack * side;
        const ny2 = (dy * s) / len + ny * setBack * side;
        const lamp: [number, number] = [lon0 + ex / mPerDegLon, lat0 + ny2 / M_PER_DEG_LAT];
        if (!lit || lit(lamp[0], lamp[1])) out.push(lamp);
        side = -side;
      }
      carry = s - len;
    }
  }
  if (out.length <= max || centreLon === undefined || centreLat === undefined)
    return out.slice(0, max);
  const k = Math.cos(centreLat * (Math.PI / 180));
  const d = (p: [number, number]) => ((p[0] - centreLon) * k) ** 2 + (p[1] - centreLat) ** 2;
  return out.sort((a, b) => d(a) - d(b)).slice(0, max);
}

/**
 * How a street lamp fades with distance in a haze or fog of visibility `visibilityM` (the
 * scene's, `2 / fogDensity`): whole out to a quarter of it, gone at one and a half times it. A
 * lamp is bright and shows a little past the visibility, where the ground under it has gone;
 * but not from a hillside the fog has taken whole. The lamps write no depth, so the grade's
 * haze does not take them by their own distance: the far side of a sound showed every street
 * lit through a fog that had taken its hills (V&V: Tromsø at night in a drizzle, 1.6 km). For
 * a billboard's `translucencyByDistance`; null in clear air (over 60 km).
 */
export function lampFogFade(visibilityM: number): { nearM: number; farM: number } | null {
  if (!(visibilityM > 0) || visibilityM > 60_000) return null;
  return { nearM: 0.25 * visibilityM, farM: 1.5 * visibilityM };
}

/**
 * How much of a street lamp's glow shows (its sprite's opacity, 0..1), from how far the town's
 * lights are on (`LightingParameters.cityLights`, 1 - smooth(-4, 2) of the Sun's elevation).
 * The lights are switched on from a Sun 2 deg up, but a lamp's glow cannot be seen against a
 * daylit sky: drawn faintly over one it came out as a dark ring, not a light (V&V: Tromsø at
 * noon in late November, the Sun on the horizon and the lights at a fifth). So the glow comes in
 * only as the sky darkens: none until the lights are half on (the Sun about 1 deg down), whole
 * when they are fully on (4 deg down).
 */
export function streetLampGlow(cityLights: number): number {
  const t = Math.min(1, Math.max(0, (cityLights - 0.5) / 0.5));
  return t * t * (3 - 2 * t);
}

/**
 * Whether a place is built up: at least `minBuildings` buildings or addresses
 * (`buildingPointsFromTile`) within `radiusM`. Street lamps stand along a town's streets, not
 * along the open road between towns: a desert highway was drawn as a string of lamps to the
 * horizon (V&V: Monument Valley at night, US 163). The z14 tiles keep a point every few dozen
 * metres of a city block at best - a big block in Paris has a handful - so the reach is wide
 * and two are enough; scattered single buildings (a ranch, a trading post) are not.
 * Checked on the real tiles: Paris (Trocadéro) keeps 89-96 % of its lamps, Tromsø all, a
 * village in the Beauce 12 of 20, Monument Valley none. Counted on a grid of `radiusM` cells,
 * the cell and its eight neighbours.
 */
export function builtUpTest(
  buildings: readonly (readonly [number, number])[],
  radiusM = 200,
  minBuildings = 2,
): (lon: number, lat: number) => boolean {
  if (buildings.length === 0) return () => false;
  const lat0 = buildings[0]![1];
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(lat0 * (Math.PI / 180));
  const cells = new Map<string, [number, number][]>();
  const cellOf = (lon: number, lat: number) =>
    [
      Math.floor((lon * mPerDegLon) / radiusM),
      Math.floor((lat * M_PER_DEG_LAT) / radiusM),
    ] as const;
  for (const [lon, lat] of buildings) {
    const [cx, cy] = cellOf(lon, lat);
    const key = `${cx},${cy}`;
    const list = cells.get(key) ?? [];
    list.push([lon, lat]);
    cells.set(key, list);
  }
  const r2 = radiusM * radiusM;
  return (lon, lat) => {
    const [cx, cy] = cellOf(lon, lat);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const [bl, bt] of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const ex = (bl - lon) * mPerDegLon;
          const ey = (bt - lat) * M_PER_DEG_LAT;
          if (ex * ex + ey * ey <= r2 && ++n >= minBuildings) return true;
        }
    return false;
  };
}

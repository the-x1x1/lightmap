import type { StreetLine } from './vector-cover.ts';

const M_PER_DEG_LAT = 111_320;

/**
 * Where the street lamps stand along a town's roads (OpenStreetMap's, `streetLinesFromTile`): one
 * every `spacingM` along each road, set back half the road's width plus a metre from its centre
 * line and alternating sides, as lamp posts are staggered along most streets. Paths and tracks
 * get none (most are unlit), nor service roads (yards and car parks: lit, but not as a street
 * is). The spacing runs on along a line across its vertices, so a curving street keeps its
 * rhythm. At most `max` lamps, the nearest to (`centreLon`, `centreLat`) kept when there are
 * more.
 */
export function streetLampPositions(
  lines: readonly StreetLine[],
  spacingM = 35,
  max = 6000,
  centreLon?: number,
  centreLat?: number,
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
        out.push([lon0 + ex / mPerDegLon, lat0 + ny2 / M_PER_DEG_LAT]);
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

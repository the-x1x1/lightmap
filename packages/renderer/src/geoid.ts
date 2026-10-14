/**
 * Sea level above the WGS84 ellipsoid (the EGM96 geoid) from the bundled 30° cells
 * (`apps/web/public/data/geoid/`, `pnpm geoid`). Terrain heights are ellipsoidal; the ground
 * texture's shore and water-edge rules read heights above sea level, and sea level sits up to
 * ±100 m off the ellipsoid (Honolulu +15 m: read as 0, no coast there was ever "near sea level").
 */

/** Degrees per cell, samples per degree, samples per cell edge (edges included). */
export const GEOID_CELL_DEG = 30;
const PER_DEG = 4;
const N = GEOID_CELL_DEG * PER_DEG + 1;

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** The cell file key (`<floor(lat/30)>_<floor(lon/30)>`) holding a point. */
export function geoidCellKey(lat: number, lon: number): string {
  const li = Math.min(2, Math.floor(Math.max(-90, Math.min(90, lat)) / GEOID_CELL_DEG));
  const oi = Math.min(5, Math.floor(wrapLon(lon) / GEOID_CELL_DEG));
  return `${li}_${oi}`;
}

/**
 * The geoid height in metres at a point, bilinear on the cell's 0.25° grid. `cell` is the
 * file's bytes (121 × 121 little-endian int16 decimetres, north row first); null when the
 * bytes do not fit or the point is outside the cell.
 */
export function geoidHeightM(
  cell: ArrayBuffer,
  key: string,
  lat: number,
  lon: number,
): number | null {
  if (cell.byteLength !== N * N * 2) return null;
  const m = /^(-?\d+)_(-?\d+)$/.exec(key);
  if (!m) return null;
  const north = (Number(m[1]) + 1) * GEOID_CELL_DEG;
  const west = Number(m[2]) * GEOID_CELL_DEG;
  const y = (north - lat) * PER_DEG;
  const x = (wrapLon(lon) - west) * PER_DEG;
  if (!(y >= 0 && y <= N - 1 && x >= 0 && x <= N - 1)) return null;
  const v = new DataView(cell);
  const at = (r: number, c: number) => v.getInt16((r * N + c) * 2, true) / 10;
  const r0 = Math.min(N - 2, Math.floor(y));
  const c0 = Math.min(N - 2, Math.floor(x));
  const fy = y - r0;
  const fx = x - c0;
  const top = at(r0, c0) * (1 - fx) + at(r0, c0 + 1) * fx;
  const bottom = at(r0 + 1, c0) * (1 - fx) + at(r0 + 1, c0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Points on rings around a place (1.5 km and 5 km, 16 each) where the controller samples the
 * terrain to find the sea's own surface near it.
 */
export function seaProbePoints(
  lat: number,
  lon: number,
): Array<{ latitude: number; longitude: number }> {
  const out: Array<{ latitude: number; longitude: number }> = [];
  const mPerDegLat = 111_320;
  const mPerDegLon = Math.max(1, 111_320 * Math.cos((lat * Math.PI) / 180));
  for (const r of [1500, 5000])
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      out.push({
        latitude: Math.max(-89.9, Math.min(89.9, lat + (r * Math.cos(a)) / mPerDegLat)),
        longitude: lon + (r * Math.sin(a)) / mPerDegLon,
      });
    }
  return out;
}

/**
 * The sea's surface near a place, in the terrain's own heights: the geoid, corrected by what
 * the terrain shows where it is lowest nearby. The geoid is good to about a metre against real
 * sea level and the terrain's sea surface differs again (Waikiki: +0.8 m), while the beach is
 * only a metre or two above it — so the coast rule needs the sea as the terrain has it. Of the
 * samples within a few metres of the geoid (the sea, or a low coastal plain), the second lowest
 * (one stray pit ignored); the geoid alone when fewer than two qualify.
 */
export function seaSurfaceFromSamples(
  geoidM: number,
  heights: ReadonlyArray<number | null>,
): number {
  const near = heights
    .filter((h): h is number => h !== null && Number.isFinite(h))
    .map((h) => h - geoidM)
    .filter((d) => d >= -4 && d <= 3)
    .sort((a, b) => a - b);
  if (near.length < 2) return geoidM;
  return geoidM + Math.max(-3, Math.min(3, near[1]!));
}

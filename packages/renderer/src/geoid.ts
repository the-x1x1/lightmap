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

/**
 * Built-up areas for the ground texture where no land-cover source is configured: Natural
 * Earth's urban-area polygons, bundled in 10° cells (`apps/web/public/data/urban/`,
 * `pnpm urban:areas`). The host fetches the cells around a pin and fills the polygons into the
 * cover map as built-up ground (`packCover('built')`), leaving everything else unknown — so a
 * city reads as a city and the countryside keeps the procedural rules.
 *
 * Pure parts here: which cells a box needs, decoding a cell, and the projection onto the cover
 * mosaic (longitude across, mercator latitude down, as the tiles are laid out).
 */
import { mercatorY, type CoverMosaic } from './land-cover.ts';

/** A polygon as rings of [longitude, latitude] in degrees; the first ring is the outline. */
export type UrbanPolygon = Array<Array<[number, number]>>;

/** Cell keys (`<floor(lat/10)>_<floor(lon/10)>`) a longitude/latitude box touches. */
export function urbanCellsFor(box: {
  west: number;
  east: number;
  south: number;
  north: number;
}): string[] {
  const out: string[] = [];
  for (let li = Math.floor(box.south / 10); li <= Math.floor(box.north / 10); li++)
    for (let oi = Math.floor(box.west / 10); oi <= Math.floor(box.east / 10); oi++) {
      // Longitudes past the antimeridian wrap back into −180…180.
      const wrapped = ((((oi + 18) % 36) + 36) % 36) - 18;
      const key = `${li}_${wrapped}`;
      if (!out.includes(key)) out.push(key);
    }
  return out;
}

/** Decode one cell file; malformed rings are skipped, never thrown on. */
export function decodeUrbanCell(json: unknown, key: string): UrbanPolygon[] {
  const m = /^(-?\d+)_(-?\d+)$/.exec(key);
  if (!m || !json || typeof json !== 'object') return [];
  const lat0 = Number(m[1]) * 10;
  const lon0 = Number(m[2]) * 10;
  const o = json as { q?: unknown; polys?: unknown };
  const q = typeof o.q === 'number' && o.q > 0 ? o.q : 10_000;
  if (!Array.isArray(o.polys)) return [];
  const out: UrbanPolygon[] = [];
  for (const poly of o.polys) {
    if (!Array.isArray(poly)) continue;
    const rings: Array<Array<[number, number]>> = [];
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 !== 0) continue;
      const pts: Array<[number, number]> = [];
      let x = 0;
      let y = 0;
      let ok = true;
      for (let i = 0; i < ring.length; i += 2) {
        const dx = ring[i];
        const dy = ring[i + 1];
        if (typeof dx !== 'number' || typeof dy !== 'number') {
          ok = false;
          break;
        }
        x += dx;
        y += dy;
        pts.push([lon0 + x / q, lat0 + y / q]);
      }
      if (ok) rings.push(pts);
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

/** The mosaic's box in degrees, for choosing cells. */
export function mosaicBox(m: CoverMosaic): {
  west: number;
  east: number;
  south: number;
  north: number;
} {
  const deg = 180 / Math.PI;
  const latOf = (merc: number) => Math.atan(Math.sinh(merc)) * deg;
  return {
    west: m.westRad * deg,
    east: m.eastRad * deg,
    south: latOf(m.southMerc),
    north: latOf(m.northMerc),
  };
}

/** Pixel position of a longitude/latitude on a `width` × `height` canvas covering the mosaic. */
export function mosaicPixel(
  m: CoverMosaic,
  width: number,
  height: number,
  lon: number,
  lat: number,
): [number, number] {
  let lonRad = (lon * Math.PI) / 180;
  // A mosaic across the antimeridian has its west edge below −π; bring the longitude into it.
  if (lonRad < m.westRad - Math.PI) lonRad += 2 * Math.PI;
  if (lonRad > m.eastRad + Math.PI) lonRad -= 2 * Math.PI;
  const x = ((lonRad - m.westRad) / (m.eastRad - m.westRad)) * width;
  const y = ((m.northMerc - mercatorY(lat)) / (m.northMerc - m.southMerc)) * height;
  return [x, y];
}

/**
 * OpenStreetMap buildings from OpenMapTiles vector tiles (OpenFreeMap serves them with no key):
 * the footprints of a tile's `building` layer with their heights, ready to extrude on the
 * terrain. Pure — the Cesium side (cesium/osm-buildings-layer.ts) does the drawing.
 *
 * OpenMapTiles gives every building `render_height` (OSM `height`, else `building:levels` × ~3 m,
 * else a default) and `render_min_height` (the bottom of a part that floats: a bridge, an
 * overhang); `hide_3d` marks an outline whose parts are drawn instead.
 */
import {
  classifyRings,
  clipRing,
  lonLatToTile,
  readVectorTile,
  tilePointToLonLat,
  type VectorValue,
} from './vector-tile.ts';

/** The zoom OpenMapTiles carries every building at (its tiles' maximum). */
export const BUILDING_TILE_ZOOM = 14;
/** A building without a usable height is drawn this tall (a two-storey house). */
export const DEFAULT_BUILDING_HEIGHT_M = 6;

export interface BuildingFootprint {
  /** Exterior ring, [lon, lat] pairs, not repeated at the end. */
  outer: [number, number][];
  holes: [number, number][][];
  heightM: number;
  minHeightM: number;
  /** A CSS colour from OSM `building:colour`, when mapped. */
  colour: string | null;
  /** The footprint's centre (vertex mean), where the ground height is read. */
  centre: [number, number];
}

const num = (v: VectorValue | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** The buildings in one z/x/y vector tile (clipped to the tile, so neighbours do not overlap). */
export function buildingsFromTile(
  data: Uint8Array,
  z: number,
  x: number,
  y: number,
  layerName = 'building',
): BuildingFootprint[] {
  const layer = readVectorTile(data, [layerName])[layerName];
  if (!layer) return [];
  const out: BuildingFootprint[] = [];
  const e = layer.extent;
  const toLonLat = (ring: number[]): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < ring.length; i += 2)
      pts.push(tilePointToLonLat(z, x, y, e, ring[i] as number, ring[i + 1] as number));
    // Drop a closing vertex equal to the first.
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (pts.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) pts.pop();
    return pts;
  };
  for (const f of layer.features) {
    if (f.type !== 3) continue;
    if (f.properties['hide_3d'] === true) continue;
    const top = num(f.properties['render_height']);
    const bottom = num(f.properties['render_min_height']) ?? 0;
    const heightM = top !== null && top > 0 ? Math.min(top, 1000) : DEFAULT_BUILDING_HEIGHT_M;
    const minHeightM = Math.max(0, Math.min(bottom, heightM - 0.5));
    const colourRaw = f.properties['colour'];
    const colour = typeof colourRaw === 'string' && colourRaw.length > 0 ? colourRaw : null;
    for (const poly of classifyRings(f.geometry)) {
      const outerTile = clipRing(poly.outer, 0, e);
      if (outerTile.length < 6) continue;
      const outer = toLonLat(outerTile);
      if (outer.length < 3) continue;
      const holes = poly.holes
        .map((h) => clipRing(h, 0, e))
        .filter((h) => h.length >= 6)
        .map(toLonLat)
        .filter((h) => h.length >= 3);
      let cx = 0;
      let cy = 0;
      for (const [lon, lat] of outer) {
        cx += lon;
        cy += lat;
      }
      out.push({
        outer,
        holes,
        heightM,
        minHeightM,
        colour,
        centre: [cx / outer.length, cy / outer.length],
      });
    }
  }
  return out;
}

/** The z14 tiles whose area comes within `radiusM` of a point, nearest first. */
export function buildingTilesAround(
  lon: number,
  lat: number,
  radiusM: number,
  z = BUILDING_TILE_ZOOM,
): { x: number; y: number }[] {
  const dLat = (radiusM / 111_320) * 1;
  const dLon = radiusM / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const a = lonLatToTile(z, lon - dLon, lat + dLat);
  const b = lonLatToTile(z, lon + dLon, lat - dLat);
  const c = lonLatToTile(z, lon, lat);
  const out: { x: number; y: number; d: number }[] = [];
  for (let x = a.x; x <= b.x; x++)
    for (let y = a.y; y <= b.y; y++) out.push({ x, y, d: Math.hypot(x - c.x, y - c.y) });
  out.sort((p, q) => p.d - q.d);
  return out.map(({ x, y }) => ({ x, y }));
}

/** Expands a TileJSON/XYZ template for one tile. */
export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{-y}', String(2 ** z - 1 - y));
}

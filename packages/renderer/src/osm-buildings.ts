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
  readVectorTileLazy,
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
  const steps = buildingsFromTileSteps(data, z, x, y, layerName);
  for (;;) {
    const s = steps.next();
    if (s.done) return s.value;
  }
}

/** Features decoded between two yields of `buildingsFromTileSteps`. */
export const BUILDINGS_PER_STEP = 400;

/**
 * `buildingsFromTile` in steps: it yields every BUILDINGS_PER_STEP features, so a caller can
 * spread a dense tile (Kyoto's hold 20,000 footprints, a tenth of a second or more to decode)
 * over frames instead of stalling one; the generator's return value is the footprints.
 */
export function* buildingsFromTileSteps(
  data: Uint8Array,
  z: number,
  x: number,
  y: number,
  layerName = 'building',
): Generator<void, BuildingFootprint[], void> {
  const layer = readVectorTileLazy(data, [layerName])[layerName];
  if (!layer) return [];
  const out: BuildingFootprint[] = [];
  const e = layer.extent;
  // Longitude is linear across the tile; latitude depends on the row alone, and nearly every
  // vertex sits on a whole row, so each row's latitude is worked out once (the inverse Mercator
  // was a third of the decode on a dense tile).
  const n = 2 ** z;
  const lonPerUnit = 360 / (n * e);
  const lon0 = (x / n) * 360 - 180;
  const rowLat = new Float64Array(e + 1).fill(Number.NaN);
  const latAt = (py: number): number => {
    if (Number.isInteger(py) && py >= 0 && py <= e) {
      const cached = rowLat[py] as number;
      if (!Number.isNaN(cached)) return cached;
      const lat = tilePointToLonLat(z, x, y, e, 0, py)[1];
      rowLat[py] = lat;
      return lat;
    }
    return tilePointToLonLat(z, x, y, e, 0, py)[1];
  };
  const toLonLat = (ring: number[]): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < ring.length; i += 2)
      pts.push([lon0 + (ring[i] as number) * lonPerUnit, latAt(ring[i + 1] as number)]);
    // Drop a closing vertex equal to the first.
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (pts.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) pts.pop();
    return pts;
  };
  for (let fi = 0; fi < layer.count; fi++) {
    if (fi > 0 && fi % BUILDINGS_PER_STEP === 0) yield;
    const f = layer.feature(fi);
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

export interface TreeSpot {
  lon: number;
  lat: number;
  /** Crown top above the ground, metres. */
  heightM: number;
  /** Crown radius, metres. */
  radiusM: number;
  /** 0..1, for the crown's shade. */
  tone: number;
  /** Needle-leaf (a cone) rather than broad-leaf (a round crown). */
  conifer: boolean;
}

/** OpenMapTiles `landcover` subclasses that are parkland: a scattering of trees, not a forest. */
const PARK_SUBCLASSES = new Set([
  'park',
  'garden',
  'village_green',
  'recreation_ground',
  'cemetery',
  'grave_yard',
]);

/** Metres between trees in a wood (a jittered grid) and in a park. */
export const WOOD_SPACING_M = 11;
export const PARK_SPACING_M = 30;
/** At most this many trees per tile; a forested tile is thinned evenly to fit. */
export const MAX_TREES_PER_TILE = 6000;

function hash2(a: number, b: number, seed: number): number {
  let h =
    (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function inRing(ring: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i] as number;
    const yi = ring[2 * i + 1] as number;
    const xj = ring[2 * j] as number;
    const yj = ring[2 * j + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Trees in a tile's `landcover`: woods and forests filled on a jittered grid, parks and gardens
 * scattered. Deterministic (the same tile always grows the same trees) and only a pattern — the
 * mapped cover says where woods are, not where each tree stands.
 */
export function treesFromTile(
  data: Uint8Array,
  z: number,
  x: number,
  y: number,
  latDeg: number,
): TreeSpot[] {
  const layer = readVectorTile(data, ['landcover'])['landcover'];
  if (!layer) return [];
  const e = layer.extent;
  // Tile units per metre at this latitude.
  const tileM = (40_075_016 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** z;
  const unitsPerM = e / tileM;
  const out: TreeSpot[] = [];
  for (const f of layer.features) {
    if (f.type !== 3) continue;
    const cls = f.properties['class'];
    const sub = f.properties['subclass'];
    const wood = cls === 'wood';
    const park = cls === 'grass' && typeof sub === 'string' && PARK_SUBCLASSES.has(sub);
    if (!wood && !park) continue;
    const spacing = (wood ? WOOD_SPACING_M : PARK_SPACING_M) * unitsPerM;
    const conifers = sub === 'forest' ? 0.5 : 0.15;
    for (const poly of classifyRings(f.geometry)) {
      const outer = clipRing(poly.outer, 0, e);
      if (outer.length < 6) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < outer.length; i += 2) {
        minX = Math.min(minX, outer[i] as number);
        maxX = Math.max(maxX, outer[i] as number);
        minY = Math.min(minY, outer[i + 1] as number);
        maxY = Math.max(maxY, outer[i + 1] as number);
      }
      const gx0 = Math.floor(minX / spacing);
      const gy0 = Math.floor(minY / spacing);
      const gx1 = Math.floor(maxX / spacing);
      const gy1 = Math.floor(maxY / spacing);
      for (let gx = gx0; gx <= gx1; gx++)
        for (let gy = gy0; gy <= gy1; gy++) {
          const px = (gx + 0.15 + 0.7 * hash2(gx, gy, x * 7 + y)) * spacing;
          const py = (gy + 0.15 + 0.7 * hash2(gy, gx, x + y * 13)) * spacing;
          if (px < 0 || py < 0 || px > e || py > e) continue;
          if (!inRing(outer, px, py)) continue;
          if (poly.holes.some((h) => inRing(h, px, py))) continue;
          const r = hash2(gx * 31 + 7, gy * 17 + 3, x ^ y);
          const conifer = r < conifers;
          const heightM = (wood ? 9 : 7) + 9 * hash2(gx + 101, gy + 57, 3);
          const [lon, lat] = tilePointToLonLat(z, x, y, e, px, py);
          out.push({
            lon,
            lat,
            heightM,
            radiusM: conifer ? heightM * 0.22 : heightM * 0.33,
            tone: hash2(gx + 11, gy + 23, 5),
            conifer,
          });
        }
    }
  }
  if (out.length <= MAX_TREES_PER_TILE) return out;
  // Thin evenly.
  const step = out.length / MAX_TREES_PER_TILE;
  const thinned: TreeSpot[] = [];
  for (let i = 0; i < out.length; i += step) thinned.push(out[Math.floor(i)] as TreeSpot);
  return thinned;
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

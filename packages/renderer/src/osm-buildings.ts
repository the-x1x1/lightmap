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
import { inMediterraneanClimate } from './leaf-season.ts';

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
  /**
   * The outline reaches its tile's edge: it is (or may be) one piece of a building the tile cut
   * in two, the other piece in the neighbouring tile. Whatever is shaped to a whole building's
   * outline (a house's roof) must leave such a piece alone.
   */
  atTileEdge?: true;
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
      // Clipping lays the cut along the tile's edge, so a vertex there marks a cut piece.
      const atEdge = outerTile.some((v) => v <= 0 || v >= e);
      out.push({
        outer,
        holes,
        heightM,
        minHeightM,
        colour,
        centre: [cx / outer.length, cy / outer.length],
        ...(atEdge ? { atTileEdge: true as const } : {}),
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
  /** Needle-leaf (a cone or a column) rather than broad-leaf. */
  conifer: boolean;
  /** The tree's build (`TREE_FORMS`). */
  form: TreeForm;
  /** In a park or garden (a tree standing on its own, drawn in more detail) rather than a wood. */
  park: boolean;
  /** 0..1, for the crown's shape: its lean, its lobes, its footprint's turn. */
  shape: number;
}

/**
 * How a tree is built. `broadleaf`: a crown wider than its trunk's height, in lobes (oak, maple,
 * beech, mango). `conifer`: a cone (pine, fir). `columnar`: a narrow spire (spruce, cypress).
 * `umbrella`: a wide flat crown on a bare trunk (monkeypod and rain tree, acacia, stone pine).
 * `palm`: a bare stem under a crown of fronds.
 */
export type TreeForm = 'broadleaf' | 'conifer' | 'columnar' | 'umbrella' | 'palm';
export const TREE_FORMS: readonly TreeForm[] = [
  'broadleaf',
  'conifer',
  'columnar',
  'umbrella',
  'palm',
];

/**
 * The share of each build among a place's trees, by climate - a rule of thumb, not a species
 * map: the woods outside a window are not a lollipop of one shape the world over. The tropics
 * (Hawaii, the Caribbean): no conifers; palms and spreading umbrella trees in parks and along
 * streets, broad-leaf canopy in the woods. The subtropics and the Mediterranean: cypresses,
 * umbrella pines, some palms in parks; pine woods. The temperate belt: broad-leaf, conifers in
 * the forests, but mostly conifers in the Pacific Northwest, the Rockies, the Alps and
 * Carpathians, and half pine on the US south-east's coastal plain. The boreal north (past 55 degrees): spruce spires and pines, some birch.
 */
export function treeMix(
  latitudeDeg: number,
  longitudeDeg: number,
  park: boolean,
  forest: boolean,
): Record<TreeForm, number> {
  const a = Math.abs(latitudeDeg);
  const mix = (b: number, c: number, col: number, u: number, p: number) => ({
    broadleaf: b,
    conifer: c,
    columnar: col,
    umbrella: u,
    palm: p,
  });
  if (a < 23.5) return park ? mix(0.3, 0, 0, 0.35, 0.35) : mix(0.6, 0, 0, 0.25, 0.15);
  if (a < 32 || inMediterraneanClimate(latitudeDeg, longitudeDeg))
    return park ? mix(0.45, 0.05, 0.2, 0.15, 0.15) : mix(0.45, 0.3, 0.05, 0.2, 0);
  if (a < 55 && inConiferBelt(latitudeDeg, longitudeDeg))
    return park ? mix(0.55, 0.3, 0.15, 0, 0) : mix(0.2, 0.45, 0.35, 0, 0);
  if (a < 55 && inPineBelt(latitudeDeg, longitudeDeg))
    return park ? mix(0.7, 0.25, 0.05, 0, 0) : mix(0.4, 0.55, 0.05, 0, 0);
  if (a < 55)
    return park
      ? mix(0.85, 0.1, 0.05, 0, 0)
      : forest
        ? mix(0.5, 0.35, 0.15, 0, 0)
        : mix(0.85, 0.1, 0.05, 0, 0);
  return park ? mix(0.65, 0.2, 0.15, 0, 0) : mix(0.25, 0.3, 0.45, 0, 0);
}

/**
 * Temperate places whose woods are mostly needle-leaf: the Pacific Northwest's rain forest of
 * Douglas fir, cedar and hemlock (northern California to the Alaska panhandle, west of the
 * Cascades and on through the Rockies), and the Alps and Carpathians' spruce and fir.
 * Rough boxes `[latMin, latMax, lonMin, lonMax]`.
 */
const CONIFER_BELT: readonly (readonly [number, number, number, number])[] = [
  [40, 60, -136, -116],
  [36, 55, -116, -104],
  [45.5, 48, 6, 16],
  [45, 50, 21, 27],
];
function inConiferBelt(lat: number, lon: number): boolean {
  return CONIFER_BELT.some((b) => lat >= b[0] && lat < b[1] && lon >= b[2] && lon < b[3]);
}

/** The south-eastern United States' coastal plain, whose woods are half pine (loblolly, longleaf). */
function inPineBelt(lat: number, lon: number): boolean {
  return lat >= 29 && lat < 37 && lon >= -96 && lon < -75;
}

/** The build a share `r` (0..1) falls on in a mix. */
export function pickForm(mix: Record<TreeForm, number>, r: number): TreeForm {
  let acc = 0;
  for (const f of TREE_FORMS) {
    acc += mix[f];
    if (r < acc) return f;
  }
  return 'broadleaf';
}

/** Height range (m) and crown radius as a share of the height, by build; a park's a little lower. */
function treeSize(
  form: TreeForm,
  wood: boolean,
  h: number,
  s: number,
): { heightM: number; radiusM: number } {
  const lerp = (lo: number, hi: number) => lo + (hi - lo) * h;
  switch (form) {
    case 'conifer': {
      const heightM = lerp(10, 22);
      return { heightM, radiusM: heightM * (0.19 + 0.06 * s) };
    }
    case 'columnar': {
      const heightM = lerp(11, 24);
      return { heightM, radiusM: heightM * (0.11 + 0.04 * s) };
    }
    case 'umbrella': {
      const heightM = lerp(7, 14);
      return { heightM, radiusM: heightM * (0.6 + 0.2 * s) };
    }
    case 'palm': {
      const heightM = lerp(8, 18);
      return { heightM, radiusM: 3.5 + 1.5 * s };
    }
    case 'broadleaf': {
      const heightM = wood ? lerp(9, 18) : lerp(7, 16);
      return { heightM, radiusM: heightM * (0.34 + 0.16 * s) };
    }
  }
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
    const lonDeg = ((x + 0.5) / 2 ** z) * 360 - 180;
    const mix = treeMix(latDeg, lonDeg, park, sub === 'forest');
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
          const form = pickForm(mix, hash2(gx * 31 + 7, gy * 17 + 3, x ^ y));
          const shape = hash2(gx + 211, gy + 97, 9);
          const size = treeSize(form, wood, hash2(gx + 101, gy + 57, 3), shape);
          const [lon, lat] = tilePointToLonLat(z, x, y, e, px, py);
          out.push({
            lon,
            lat,
            ...size,
            tone: hash2(gx + 11, gy + 23, 5),
            conifer: form === 'conifer' || form === 'columnar',
            form,
            park,
            shape,
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

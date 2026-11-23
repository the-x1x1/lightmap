/**
 * Land cover from OpenStreetMap: the OpenMapTiles `landcover`, `landuse` and `water` layers
 * read into the cover classes the ground material understands (`land-cover.ts`), so the
 * painted ground knows a park from a car park and a wood from a field wherever OpenFreeMap has
 * tiles — no land-cover raster to configure. Mapped polygons, drawn by the host into the same
 * cover map a WorldCover raster would fill; later entries paint over earlier ones.
 */
import type { CoverClass } from './land-cover.ts';
import { classifyRings, clipRing, tilePointToLonLat } from './vector-tile.ts';
import { readVectorTile } from './vector-tile.ts';

export interface CoverShape {
  cls: CoverClass;
  /** Outer ring then holes, [lon, lat] pairs. */
  rings: [number, number][][];
}

/** Painting order: broad uses first, then cover, then water on top. */
const ORDER: Record<string, number> = { landuse: 0, landcover: 1, water: 2 };

const LANDUSE_BUILT = new Set([
  'residential',
  'commercial',
  'industrial',
  'retail',
  'railway',
  'garages',
  'quarry',
  'military',
  'hospital',
  'school',
  'university',
  'college',
  'neighbourhood',
  'suburb',
  'quarter',
]);

function classFor(layer: string, props: Record<string, unknown>): CoverClass | null {
  const cls = props['class'];
  const sub = props['subclass'];
  if (layer === 'water') return 'water';
  if (layer === 'landuse') {
    if (typeof cls !== 'string') return null;
    if (LANDUSE_BUILT.has(cls)) return 'built';
    if (cls === 'cemetery' || cls === 'pitch' || cls === 'playground' || cls === 'stadium')
      return 'grass';
    return null;
  }
  if (layer === 'landcover') {
    switch (cls) {
      case 'wood':
        return 'tree';
      case 'grass':
        return sub === 'scrub' || sub === 'heath' ? 'shrub' : 'grass';
      case 'farmland':
        return 'crop';
      case 'wetland':
        return sub === 'mangrove' ? 'mangrove' : 'wetland';
      case 'sand':
      case 'rock':
        return 'bare';
      case 'ice':
        return 'snow';
      default:
        return null;
    }
  }
  return null;
}

/** The cover polygons of one vector tile, in painting order. */
export function coverShapesFromTile(
  data: Uint8Array,
  z: number,
  x: number,
  y: number,
): CoverShape[] {
  const layers = readVectorTile(data, ['landuse', 'landcover', 'water']);
  const out: (CoverShape & { order: number })[] = [];
  for (const [name, layer] of Object.entries(layers)) {
    const e = layer.extent;
    for (const f of layer.features) {
      if (f.type !== 3) continue;
      const cls = classFor(name, f.properties);
      if (!cls) continue;
      for (const poly of classifyRings(f.geometry)) {
        const toLonLat = (ring: number[]) => {
          const pts: [number, number][] = [];
          for (let i = 0; i + 1 < ring.length; i += 2)
            pts.push(tilePointToLonLat(z, x, y, e, ring[i] as number, ring[i + 1] as number));
          return pts;
        };
        out.push({
          cls,
          rings: [toLonLat(poly.outer), ...poly.holes.map(toLonLat)],
          order: ORDER[name] ?? 0,
        });
      }
    }
  }
  out.sort((a, b) => a.order - b.order);
  return out.map(({ cls, rings }) => ({ cls, rings }));
}

export interface StreetLine {
  /** 'road' is asphalt, 'path' paving (footways, pedestrian streets, tracks). */
  kind: 'road' | 'path';
  widthM: number;
  points: [number, number][];
}

/**
 * Where a vector tile's buildings stand: each address point (the `housenumber` layer: in
 * OpenMapTiles' z14 tiles a town keeps its addresses where most of its building footprints
 * are dropped - Tromsø's centre tile has 13 footprints) and the first corner of each footprint
 * left (`building`), and points over the residential, commercial and retail land use. For
 * telling a built-up street from an open road that is near enough.
 */
export function buildingPointsFromTile(
  data: Uint8Array,
  z: number,
  x: number,
  y: number,
): [number, number][] {
  const layers = readVectorTile(data, ['building', 'housenumber', 'landuse']);
  const out: [number, number][] = [];
  for (const layer of [layers['building'], layers['housenumber']]) {
    if (!layer) continue;
    for (const f of layer.features) {
      if (f.type !== 1 && f.type !== 3) continue;
      const first = f.geometry[0];
      if (!first || first.length < 2) continue;
      out.push(tilePointToLonLat(z, x, y, layer.extent, first[0] as number, first[1] as number));
    }
  }
  // Built-up land use: a town whose houses are not mapped (nor its addresses) is still mapped
  // as a residential, commercial or retail area, and it is lit at night. Points on an 80 m grid
  // inside those areas count as built-up, so its streets get their lamps (they had none: the
  // lamps went only where footprints or addresses were).
  const landuse = layers['landuse'];
  if (landuse) {
    const e = landuse.extent;
    const latDeg = tilePointToLonLat(z, x, y, e, e / 2, e / 2)[1];
    const tileM = (40_075_016 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** z;
    const step = (BUILT_UP_GRID_M * e) / tileM;
    for (const f of landuse.features) {
      if (f.type !== 3 || !BUILT_UP_LANDUSE.has(String(f.properties['class']))) continue;
      for (const poly of classifyRings(f.geometry)) {
        const outer = clipRing(poly.outer, 0, e);
        if (outer.length < 6) continue;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let k = 0; k + 1 < outer.length; k += 2) {
          minX = Math.min(minX, outer[k] as number);
          maxX = Math.max(maxX, outer[k] as number);
          minY = Math.min(minY, outer[k + 1] as number);
          maxY = Math.max(maxY, outer[k + 1] as number);
        }
        for (let px = (Math.floor(minX / step) + 0.5) * step; px <= maxX; px += step)
          for (let py = (Math.floor(minY / step) + 0.5) * step; py <= maxY; py += step) {
            if (!inRing(outer, px, py) || poly.holes.some((h) => inRing(h, px, py))) continue;
            out.push(tilePointToLonLat(z, x, y, e, px, py));
          }
      }
    }
  }
  return out;
}

/** The land uses that are built up and lit at night (OpenMapTiles `landuse` classes). */
const BUILT_UP_LANDUSE: ReadonlySet<string> = new Set(['residential', 'commercial', 'retail']);
/** Spacing of the built-up points laid over those areas, metres. */
const BUILT_UP_GRID_M = 80;

/** Whether (x, y) lies inside a ring of [x, y, x, y, ...] (even-odd). */
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

/** Width on the ground by OpenMapTiles `transportation` class, metres. */
export const ROAD_WIDTH_M: Record<string, number> = {
  motorway: 22,
  trunk: 16,
  primary: 14,
  secondary: 11,
  tertiary: 9,
  minor: 7,
  service: 4.5,
  raceway: 10,
  busway: 7,
};
const PATH_WIDTH_M: Record<string, number> = {
  path: 2.5,
  track: 3,
  pedestrian: 6,
};

/**
 * The streets of a vector tile (`transportation` lines): roads as asphalt to their usual width
 * by class, paths and tracks as paving. Bridges and tunnels are left out (they are not on the
 * ground where the map would paint them).
 */
export function streetLinesFromTile(
  data: Uint8Array,
  z: number,
  x: number,
  y: number,
): StreetLine[] {
  const layer = readVectorTile(data, ['transportation'])['transportation'];
  if (!layer) return [];
  const e = layer.extent;
  const out: StreetLine[] = [];
  for (const f of layer.features) {
    if (f.type !== 2) continue;
    const cls = f.properties['class'];
    if (typeof cls !== 'string') continue;
    const brunnel = f.properties['brunnel'];
    if (brunnel === 'bridge' || brunnel === 'tunnel') continue;
    const sub = f.properties['subclass'];
    const pedestrian = cls === 'path' || sub === 'pedestrian' || sub === 'footway';
    const roadW = ROAD_WIDTH_M[cls];
    const pathW = pedestrian
      ? (PATH_WIDTH_M[String(sub)] ?? PATH_WIDTH_M['path'])
      : PATH_WIDTH_M[cls];
    const kind: StreetLine['kind'] | null =
      roadW !== undefined && !pedestrian ? 'road' : pathW !== undefined ? 'path' : null;
    if (!kind) continue;
    // A ramp or a link road is narrower than its class.
    const ramp = f.properties['ramp'] === 1 || f.properties['ramp'] === true;
    const widthM = (kind === 'road' ? (roadW as number) : (pathW as number)) * (ramp ? 0.6 : 1);
    for (const line of f.geometry) {
      const points: [number, number][] = [];
      for (let i = 0; i + 1 < line.length; i += 2)
        points.push(tilePointToLonLat(z, x, y, e, line[i] as number, line[i + 1] as number));
      if (points.length >= 2) out.push({ kind, widthM, points });
    }
  }
  return out;
}

/** A bridge's deck as the map draws it: its line and how wide it is, metres. */
export interface BridgeLine {
  widthM: number;
  points: [number, number][];
}

/**
 * The bridges of a vector tile (`transportation` lines with `brunnel` = bridge): roads, paths
 * and railways, at their usual width (a railway as a 6 m deck). Where a viewpoint stands on one
 * the eye belongs on its deck, not on the water or the valley under it.
 */
export function bridgeLinesFromTile(
  data: Uint8Array,
  z: number,
  x: number,
  y: number,
): BridgeLine[] {
  const layer = readVectorTile(data, ['transportation'])['transportation'];
  if (!layer) return [];
  const e = layer.extent;
  const out: BridgeLine[] = [];
  for (const f of layer.features) {
    if (f.type !== 2 || f.properties['brunnel'] !== 'bridge') continue;
    const cls = f.properties['class'];
    if (typeof cls !== 'string') continue;
    const sub = f.properties['subclass'];
    const widthM =
      ROAD_WIDTH_M[cls] ??
      PATH_WIDTH_M[String(sub)] ??
      PATH_WIDTH_M[cls] ??
      (cls === 'rail' || cls === 'transit' ? 6 : 3);
    for (const line of f.geometry) {
      const points: [number, number][] = [];
      for (let i = 0; i + 1 < line.length; i += 2)
        points.push(tilePointToLonLat(z, x, y, e, line[i] as number, line[i + 1] as number));
      if (points.length >= 2) out.push({ widthM, points });
    }
  }
  return out;
}

/**
 * The bridge under a point - within half its width and two metres of its line - or null. A
 * small-area metric approximation (metres from degrees at the point's latitude).
 */
export function bridgeAt(
  bridges: readonly BridgeLine[],
  lon: number,
  lat: number,
): BridgeLine | null {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_540;
  let best: BridgeLine | null = null;
  let bestGap = Infinity;
  for (const b of bridges) {
    for (let i = 0; i + 1 < b.points.length; i++) {
      const [ax, ay] = b.points[i] as [number, number];
      const [bx, by] = b.points[i + 1] as [number, number];
      const ux = (bx - ax) * kx;
      const uy = (by - ay) * ky;
      const px = (lon - ax) * kx;
      const py = (lat - ay) * ky;
      const len2 = ux * ux + uy * uy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * ux + py * uy) / len2)) : 0;
      const d = Math.hypot(px - t * ux, py - t * uy);
      const gap = d - (b.widthM / 2 + 2);
      if (gap <= 0 && gap < bestGap) {
        best = b;
        bestGap = gap;
      }
    }
  }
  return best;
}

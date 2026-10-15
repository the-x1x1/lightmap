/**
 * Land cover from OpenStreetMap: the OpenMapTiles `landcover`, `landuse` and `water` layers
 * read into the cover classes the ground material understands (`land-cover.ts`), so the
 * painted ground knows a park from a car park and a wood from a field wherever OpenFreeMap has
 * tiles — no land-cover raster to configure. Mapped polygons, drawn by the host into the same
 * cover map a WorldCover raster would fill; later entries paint over earlier ones.
 */
import type { CoverClass } from './land-cover.ts';
import { classifyRings, tilePointToLonLat } from './vector-tile.ts';
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

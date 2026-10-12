/**
 * Land cover for the ground texture (texture pack stage 2, `ROADMAP.md` Phase 4): a land-cover
 * raster served as map tiles — ESA WorldCover (10 m, CC BY 4.0) or the Copernicus Global Land
 * Cover (100 m, CC BY 4.0) in their published colour palettes — is read around the pin and
 * turned into a small **cover map** the ground material samples, so the procedural surface can
 * tell a forest from a field, a city from open ground, a desert from steppe, and an ice sheet
 * from a snowfield. The procedural surface keeps supplying the detail (grain, relief, the
 * seasonal snow); the cover map decides what the open ground is.
 *
 * Each tile pixel is classified by the nearest palette colour (the tiles are rendered classes,
 * not photographs, so an exact match is the rule and a small distance the tolerance for
 * resampling at tile edges), and the classes are packed into four channels the shader reads:
 *   R canopy (closed forest 1, open forest / mangrove ≈ 0.8, shrub ≈ 0.45, wetland ≈ 0.35, moss ≈ 0.15),
 *   G built-up (1 in a city),
 *   B bare ground (≈ 0.67 for bare rock / sand, 1 for permanent snow and ice),
 *   A cropland (1) — and A = 16/255 on every other *known* pixel, 0 where the tile said nothing
 *     the palette knows (or no tile came), so the shader can tell "open ground" from "unknown".
 * Pure, unit-tested; the tile fetch and texture upload are the host's.
 */

export type CoverClass =
  | 'tree'
  | 'open-forest'
  | 'shrub'
  | 'grass'
  | 'crop'
  | 'built'
  | 'bare'
  | 'snow'
  | 'water'
  | 'wetland'
  | 'mangrove'
  | 'moss';

export type LandCoverPalette = 'worldcover' | 'copernicus';

interface PaletteEntry {
  rgb: [number, number, number];
  cls: CoverClass;
}

const hex = (s: string): [number, number, number] => [
  parseInt(s.slice(0, 2), 16),
  parseInt(s.slice(2, 4), 16),
  parseInt(s.slice(4, 6), 16),
];

/** ESA WorldCover 2020/2021 product legend colours. */
const WORLDCOVER: PaletteEntry[] = [
  { rgb: hex('006400'), cls: 'tree' },
  { rgb: hex('ffbb22'), cls: 'shrub' },
  { rgb: hex('ffff4c'), cls: 'grass' },
  { rgb: hex('f096ff'), cls: 'crop' },
  { rgb: hex('fa0000'), cls: 'built' },
  { rgb: hex('b4b4b4'), cls: 'bare' },
  { rgb: hex('f0f0f0'), cls: 'snow' },
  { rgb: hex('0064c8'), cls: 'water' },
  { rgb: hex('0096a0'), cls: 'wetland' },
  { rgb: hex('00cf75'), cls: 'mangrove' },
  { rgb: hex('fae6a0'), cls: 'moss' },
];

/** Copernicus Global Land Cover (CGLS-LC100, discrete classification) legend colours. */
const COPERNICUS: PaletteEntry[] = [
  { rgb: hex('ffbb22'), cls: 'shrub' },
  { rgb: hex('ffff4c'), cls: 'grass' },
  { rgb: hex('f096ff'), cls: 'crop' },
  { rgb: hex('fa0000'), cls: 'built' },
  { rgb: hex('b4b4b4'), cls: 'bare' },
  { rgb: hex('f0f0f0'), cls: 'snow' },
  { rgb: hex('0032c8'), cls: 'water' },
  { rgb: hex('0096a0'), cls: 'wetland' },
  { rgb: hex('fae6a0'), cls: 'moss' },
  // Closed forest (111–116).
  { rgb: hex('58481f'), cls: 'tree' },
  { rgb: hex('009900'), cls: 'tree' },
  { rgb: hex('70663e'), cls: 'tree' },
  { rgb: hex('00cc00'), cls: 'tree' },
  { rgb: hex('4e751f'), cls: 'tree' },
  { rgb: hex('007800'), cls: 'tree' },
  // Open forest (121–126).
  { rgb: hex('666000'), cls: 'open-forest' },
  { rgb: hex('8db400'), cls: 'open-forest' },
  { rgb: hex('8d7400'), cls: 'open-forest' },
  { rgb: hex('a0dc00'), cls: 'open-forest' },
  { rgb: hex('929900'), cls: 'open-forest' },
  { rgb: hex('648c00'), cls: 'open-forest' },
  { rgb: hex('000080'), cls: 'water' },
];

const PALETTES: Record<LandCoverPalette, PaletteEntry[]> = {
  worldcover: WORLDCOVER,
  copernicus: COPERNICUS,
};

/** Nearest-colour tolerance (Euclidean RGB): resampled tile edges, never a photograph's hue. */
export const PALETTE_TOLERANCE = 28;

/** The class of a tile pixel, or null when no palette colour is within tolerance (or the pixel is transparent). */
export function classifyCover(
  rgb: readonly [number, number, number],
  palette: LandCoverPalette,
  alpha = 255,
): CoverClass | null {
  if (alpha < 128) return null;
  let best: PaletteEntry | null = null;
  let bestD = Infinity;
  for (const e of PALETTES[palette]) {
    const d = Math.hypot(rgb[0] - e.rgb[0], rgb[1] - e.rgb[1], rgb[2] - e.rgb[2]);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best && bestD <= PALETTE_TOLERANCE ? best.cls : null;
}

/** The alpha value that marks a known, non-crop pixel in the cover map. */
export const COVER_KNOWN_ALPHA = 16;

/** The four channels a class is packed into (0–255). */
export function packCover(cls: CoverClass | null): [number, number, number, number] {
  switch (cls) {
    case 'tree':
      return [255, 0, 0, COVER_KNOWN_ALPHA];
    case 'open-forest':
    case 'mangrove':
      return [204, 0, 0, COVER_KNOWN_ALPHA];
    case 'shrub':
      return [115, 0, 0, COVER_KNOWN_ALPHA];
    case 'wetland':
      return [90, 0, 0, COVER_KNOWN_ALPHA];
    case 'moss':
      return [38, 0, 60, COVER_KNOWN_ALPHA];
    case 'grass':
      return [0, 0, 0, COVER_KNOWN_ALPHA];
    case 'crop':
      return [0, 0, 0, 255];
    case 'built':
      return [0, 255, 0, COVER_KNOWN_ALPHA];
    case 'bare':
      return [0, 0, 170, COVER_KNOWN_ALPHA];
    case 'snow':
      return [0, 0, 255, COVER_KNOWN_ALPHA];
    case 'water':
      // Water is the water mask's (and the shore rule's); the cover map calls it open ground.
      return [0, 0, 0, COVER_KNOWN_ALPHA];
    case null:
      return [0, 0, 0, 0];
  }
}

export interface CoverMap {
  /** RGBA, `width × height × 4`, packed as `packCover` says (its own buffer, so a canvas can take it). */
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  /** Share of pixels the palette knew, 0–1. */
  known: number;
  /** Class shares over the known pixels, for the attribution line and tests. */
  shares: Partial<Record<CoverClass, number>>;
}

/**
 * The cover map from a tile mosaic's pixels (RGBA, `width × height`): every pixel classified
 * and packed. A mosaic the palette does not recognise at all (a wrong palette setting, a
 * styled map by mistake) comes back with `known` 0 and the shader ignores it.
 */
export function coverMapFromPixels(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  palette: LandCoverPalette,
): CoverMap {
  const n = width * height;
  const data = new Uint8ClampedArray(n * 4);
  const counts = new Map<CoverClass, number>();
  let known = 0;
  // Classification is per distinct colour; tiles carry a dozen colours, so cache by packed RGB.
  const cache = new Map<number, CoverClass | null>();
  for (let i = 0; i < n; i++) {
    const r = pixels[i * 4] ?? 0;
    const g = pixels[i * 4 + 1] ?? 0;
    const b = pixels[i * 4 + 2] ?? 0;
    const a = pixels[i * 4 + 3] ?? 255;
    let cls: CoverClass | null;
    if (a < 128) cls = null;
    else {
      const key = (r << 16) | (g << 8) | b;
      const hit = cache.get(key);
      if (hit !== undefined) cls = hit;
      else {
        cls = classifyCover([r, g, b], palette);
        cache.set(key, cls);
      }
    }
    if (cls !== null) {
      known++;
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
    const p = packCover(cls);
    data[i * 4] = p[0];
    data[i * 4 + 1] = p[1];
    data[i * 4 + 2] = p[2];
    data[i * 4 + 3] = p[3];
  }
  const shares: Partial<Record<CoverClass, number>> = {};
  for (const [cls, c] of counts) shares[cls] = Math.round((c / Math.max(1, known)) * 1000) / 1000;
  return { data, width, height, known: n ? Math.round((known / n) * 1000) / 1000 : 0, shares };
}

/** Web Mercator tile arithmetic (EPSG:3857, the XYZ convention: y down from the north). */
export function lonToTileX(lonDeg: number, zoom: number): number {
  return ((lonDeg + 180) / 360) * Math.pow(2, zoom);
}
export function latToTileY(latDeg: number, zoom: number): number {
  const lat = (Math.max(-85.0511, Math.min(85.0511, latDeg)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * Math.pow(2, zoom);
}
export function tileXToLon(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}
export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** The mercator "y" the shader uses: ln tan(π/4 + φ/2), from a latitude in degrees. */
export function mercatorY(latDeg: number): number {
  const lat = (Math.max(-85.0511, Math.min(85.0511, latDeg)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

export interface CoverMosaic {
  zoom: number;
  /** Tile columns and rows covered, inclusive. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Bounds in radians (longitude) and mercator y (`mercatorY`), for the shader's lookup. */
  westRad: number;
  eastRad: number;
  northMerc: number;
  southMerc: number;
  /** Rough ground size of a pixel at the centre, metres (256 px tiles). */
  metresPerPixel: number;
}

/** How far the cover map reaches from the pin at least, metres (each way). */
export const COVER_REACH_M = 12_000;

/**
 * The tile block to read around a point: the zoom at which a 3 × 3 block of 256 px tiles
 * spans at least `COVER_REACH_M` each way (zoom 12 near the equator, 11 by 60° where a tile
 * covers less ground), capped by the provider's maximum; the tiles are the eight neighbours
 * around the pin's own.
 */
export function coverMosaicFor(
  point: { latitude: number; longitude: number },
  maxZoom: number,
): CoverMosaic {
  const cosLat = Math.cos((point.latitude * Math.PI) / 180);
  const EARTH_CIRCUMFERENCE_M = 40_075_016.7;
  let zoom = Math.min(maxZoom, 14);
  while (zoom > 1) {
    const tileM = (EARTH_CIRCUMFERENCE_M * cosLat) / Math.pow(2, zoom);
    if (1.5 * tileM >= COVER_REACH_M) break;
    zoom--;
  }
  const n = Math.pow(2, zoom);
  const cx = Math.floor(lonToTileX(point.longitude, zoom));
  const cy = Math.floor(latToTileY(point.latitude, zoom));
  const x0 = cx - 1;
  const x1 = cx + 1;
  const y0 = Math.max(0, cy - 1);
  const y1 = Math.min(n - 1, cy + 1);
  return {
    zoom,
    x0,
    x1,
    y0,
    y1,
    westRad: (tileXToLon(x0, zoom) * Math.PI) / 180,
    eastRad: (tileXToLon(x1 + 1, zoom) * Math.PI) / 180,
    northMerc: mercatorY(tileYToLat(y0, zoom)),
    southMerc: mercatorY(tileYToLat(y1 + 1, zoom)),
    metresPerPixel: (EARTH_CIRCUMFERENCE_M * cosLat) / n / 256,
  };
}

/** Tile URL from an XYZ template with `{z}`, `{x}`, `{y}` (and `{-y}` for TMS rows). */
export function tileUrl(template: string, z: number, x: number, y: number): string {
  const n = Math.pow(2, z);
  const wrappedX = ((x % n) + n) % n;
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(wrappedX))
    .replace('{-y}', String(n - 1 - y))
    .replace('{y}', String(y));
}

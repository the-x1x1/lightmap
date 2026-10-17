/**
 * The season on the far imagery, pixel by pixel. The imagery is a summer composite (Sentinel-2
 * cloudless), so beyond the painted ground the hills stayed summer-green through a Vermont
 * October and a Montreal February (V&V). Tinting a whole imagery layer moves water and towns
 * with the woods, so it could only be gentle. Here each tile's pixels are read as what they
 * show - woods (dark, green), open grass and fields (lighter green), water (blue over green),
 * the rest (towns, rock, sand) - and only the vegetation takes the season: broad-leaf woods (the
 * darkest, conifers, keep their green) turn a mosaic
 * of yellow, orange and red in autumn and go grey-brown when bare, grass goes tan when dormant,
 * and lying snow whitens open ground fully and woods partly (the trees stand above it).
 *
 * Pure and unit-tested; the host runs it on each imagery tile as it arrives.
 */

export interface ImagerySeason {
  /** Broad-leaf canopy in leaf: 0 bare, 1 full (`leafSeason`). */
  leafOn: number;
  /** How far the broad leaves have turned, 0-1. */
  autumn: number;
  /** How green open grass is, 0 dormant - 1 growing. */
  grassGreen: number;
  /** Lying snow, 0-1 (`lowlandSnowCover`). */
  snow: number;
  /**
   * The share of broad-leaf stands that are deciduous (`LeafSeason.deciduous`; all when left
   * out): the rest keep their summer green, the deciduous ones take the full season.
   */
  deciduous?: number;
}

export const SUMMER: ImagerySeason = { leafOn: 1, autumn: 0, grassGreen: 1, snow: 0 };

/** Whether a season changes the imagery at all (summer leaves the tiles as they are). */
export function seasonShows(s: ImagerySeason): boolean {
  return s.autumn * s.leafOn > 0.02 || s.leafOn < 0.98 || s.grassGreen < 0.98 || s.snow > 0.02;
}

/** A key that changes only when the season moves enough to be seen (tiles are redone on it). */
export function seasonKey(s: ImagerySeason): string {
  const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 10);
  return `${q(s.leafOn)}|${q(s.autumn * s.leafOn)}|${q(s.grassGreen)}|${q(s.snow)}|${q(s.deciduous ?? 1)}`;
}

// Autumn colours of a broad-leaf wood seen from far off (sRGB 0-255): yellow, orange, red.
const FALL: readonly (readonly [number, number, number])[] = [
  [158, 120, 34],
  [170, 86, 28],
  [128, 44, 30],
];
const TWIGS: readonly [number, number, number] = [104, 92, 80];
const DORMANT: readonly [number, number, number] = [160, 144, 104];
const SNOW: readonly [number, number, number] = [236, 239, 243];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Recolours RGBA pixels in place (`data` as from ImageData) for a season. `seedX`/`seedY` place
 * the tile so the autumn mosaic does not repeat from tile to tile.
 */
export function seasonalisePixels(
  data: Uint8ClampedArray,
  width: number,
  season: ImagerySeason,
  seedX = 0,
  seedY = 0,
): void {
  // The averages are over every broad-leaf stand; a deciduous stand takes the whole season and
  // the others none (an evergreen eucalypt or holm-oak wood stays green), drawn per stand.
  const deciduous = Math.max(0.01, Math.min(1, season.deciduous ?? 1));
  const standLeafOn = Math.max(0, 1 - (1 - clamp01(season.leafOn)) / deciduous);
  const turned = Math.min(1, clamp01(season.autumn) / deciduous) * standLeafOn;
  const bare = 1 - standLeafOn;
  const dormant = 1 - clamp01(season.grassGreen);
  const snow = clamp01(season.snow);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Water: blue over green and red (and the dark of deep water) - never touched.
    if (b > g + 4 && b > r + 10) continue;
    // Vegetation: green leading both red and blue, by how clearly.
    const lead = g - Math.max(r, b * 1.05);
    const veg = clamp01(lead / 18) * clamp01((max - min) / 20);
    // Woods are dark; open grass and fields are lighter.
    const wood = veg * (1 - clamp01((lum - 70) / 50));
    const grass = veg - wood;
    // The darkest woods are conifers (spruce, fir, pine), which keep their needles all year.
    const broad = clamp01((lum - 32) / 22);
    let nr = r;
    let ng = g;
    let nb = b;
    // Stands of a few pixels share a colour and a kind (a hash of the 4 x 4 cell).
    let h = 0;
    let seasonal = true;
    if (wood > 0 && (turned > 0 || bare > 0)) {
      const x = (p % width) + seedX;
      const y = Math.floor(p / width) + seedY;
      h = fract(Math.sin((x >> 2) * 12.9898 + (y >> 2) * 78.233) * 43758.5453);
      seasonal = deciduous >= 1 || fract(h * 11.1) < deciduous;
    }
    if (wood > 0 && turned > 0 && seasonal) {
      const c = FALL[Math.floor(h * 3) % 3] as readonly [number, number, number];
      const k = (lum / 80) * (0.85 + 0.3 * fract(h * 7.13));
      const w = wood * broad * turned * 0.9;
      nr += (c[0] * k - nr) * w;
      ng += (c[1] * k - ng) * w;
      nb += (c[2] * k - nb) * w;
    }
    if (wood > 0 && bare > 0 && seasonal) {
      const k = lum / 80;
      const w = wood * broad * bare * 0.75;
      nr += (TWIGS[0] * k - nr) * w;
      ng += (TWIGS[1] * k - ng) * w;
      nb += (TWIGS[2] * k - nb) * w;
    }
    if (grass > 0 && dormant > 0) {
      const k = lum / 140;
      const w = grass * dormant * 0.75;
      nr += (DORMANT[0] * k - nr) * w;
      ng += (DORMANT[1] * k - ng) * w;
      nb += (DORMANT[2] * k - nb) * w;
    }
    if (snow > 0) {
      // Open ground goes white; woods keep much of their dark (trees stand above the snow).
      const w = snow * (0.9 - 0.5 * wood);
      nr += (SNOW[0] - nr) * w;
      ng += (SNOW[1] - ng) * w;
      nb += (SNOW[2] - nb) * w;
    }
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
}

function fract(v: number): number {
  return v - Math.floor(v);
}

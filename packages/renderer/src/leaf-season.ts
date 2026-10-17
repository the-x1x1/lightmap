/**
 * The leaf season: how far broad-leaf trees are in leaf, how far their leaves have turned, and
 * how green open grass is, at a latitude on a day of the year. The 3D trees, the painted ground
 * and the far imagery (a summer composite) take their colour from it, so a mid-October planner
 * in Vermont shows reds and oranges, a January one bare grey-brown crowns over tan grass, and a
 * tropical one the same green all year.
 *
 * An approximation, from the timing of the classic phenology records: in continental climates
 * leaf-out about early April at 35°, early May at 45°, and peak colour about late October at
 * 40°, early October at 45°, late September at 60°; later in spring and earlier in autumn with
 * height. The west coasts of the continents in the westerlies (Europe west of about 15° E, the
 * Pacific coast of North America, New Zealand, southern Chile; southern Australia in part) are
 * maritime: about three weeks
 * earlier in spring, later in autumn, and grass that stays greener through winter. Southern
 * Japan's maples turn about three weeks later than its latitude says, the northeastern US
 * seaboard's trees about two. The transitions are spread
 * over weeks so a place's own year falls inside them. The seasons flip across the equator, and
 * inside about 25° the trees keep their leaves.
 *
 * South of the equator most woods are evergreen whatever the latitude - eucalypts in Australia,
 * southern beech and podocarps in New Zealand, sclerophyll scrub in Chile and the Cape - so only
 * about a third of the canopy (the planted oaks, planes and poplars of towns and farms) turns and
 * drops (`deciduousShare`); the deciduous southern beech of the Patagonian Andes is the exception.
 */
export interface LeafSeason {
  /** Broad-leaf canopy in leaf: 0 bare, 1 full. */
  leafOn: number;
  /** How far the broad leaves have turned: 0 green, 1 full autumn colour. */
  autumn: number;
  /** How green open grass is: 0 winter-dormant, 1 growing. */
  grassGreen: number;
}

export const EVERGREEN: LeafSeason = { leafOn: 1, autumn: 0, grassGreen: 1 };

/** Winter grass is dormant olive-tan, not straw: maritime winters keep it greener than this model knows. */
const GRASS_DORMANCY = 0.65;

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The share of the broad-leaf canopy that turns and drops: all of it north of the equator (its
 * conifers are told apart by colour), about a third in the south's evergreen woods, most of it
 * in the Patagonian Andes' deciduous beech (lenga, nire). Unknown longitude in the south: a third.
 */
export function deciduousShare(latitudeDeg: number, longitudeDeg: number | null): number {
  if (latitudeDeg >= 0) return 1;
  if (longitudeDeg !== null && latitudeDeg < -37 && longitudeDeg > -76 && longitudeDeg < -68)
    return 0.8;
  return 0.35;
}

/**
 * How maritime a place's seasons are, 0 (continental) to 1, and how many days later than its
 * latitude its leaves turn. A rule of thumb by region, not a climate map.
 */
export function seasonalClimate(
  latitudeDeg: number,
  longitudeDeg: number,
): { maritime: number; lateAutumnDays: number } {
  const lat = latitudeDeg;
  const lon = ((((longitudeDeg + 180) % 360) + 360) % 360) - 180;
  let maritime = 0;
  let lateAutumnDays = 0;
  if (lat > 35 && lat < 72 && lon > -25 && lon < 40) {
    // Europe: the Atlantic's reach fades eastward across Germany and Poland.
    maritime = 1 - smooth(5, 30, lon);
  } else if (lat > 35 && lat < 62 && lon > -135 && lon < -110) {
    // The Pacific coast of North America, inside the coast ranges.
    maritime = 1 - smooth(-122, -114, lon);
  } else if (lat < -34 && lon > 165) {
    maritime = 1; // New Zealand
  } else if (lat < -38 && lon > -76 && lon < -70) {
    maritime = 1; // southern Chile
  } else if (lat < -34 && lon > 113 && lon < 154) {
    // Southern Australia and Tasmania: the Southern Ocean keeps autumn frost-free and long (the
    // planted oaks and elms of Melbourne, Hobart and the Dandenongs hold their colour into May).
    maritime = 0.7;
  }
  if (lat > 30 && lat < 40 && lon > 129 && lon < 142) lateAutumnDays = 22; // Honshu, Kyushu, Shikoku
  // The northeastern seaboard (Washington to Boston): the ocean and the cities hold autumn back
  // about two weeks against inland places of the same latitude - Central Park peaks in early to
  // mid November, Boston's Common in late October (V&V: the rule had Central Park half bare on
  // 3 November).
  if (lat > 37 && lat < 43 && lon > -77.5 && lon < -69.5) lateAutumnDays = 14;
  return { maritime, lateAutumnDays };
}

/** The middle of leaf-out (half the canopy in leaf), northern day of the year. */
export function leafOutDay(latitudeDeg: number, heightM = 0, maritime = 0): number {
  return 10 + 2.4 * Math.abs(latitudeDeg) + Math.max(0, heightM) / 40 - 20 * maritime;
}

/** The day of peak autumn colour, northern day of the year. */
export function peakColourDay(
  latitudeDeg: number,
  heightM = 0,
  maritime = 0,
  lateAutumnDays = 0,
): number {
  return (
    360 - 1.6 * Math.abs(latitudeDeg) - Math.max(0, heightM) / 50 + 18 * maritime + lateAutumnDays
  );
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function leafSeason(
  latitudeDeg: number,
  dayOfYear: number,
  heightM = 0,
  longitudeDeg: number | null = null,
): LeafSeason {
  const lat = Math.abs(latitudeDeg);
  const climate =
    longitudeDeg === null
      ? { maritime: 0, lateAutumnDays: 0 }
      : seasonalClimate(latitudeDeg, longitudeDeg);
  // How seasonal the trees are: none in the tropics, fully from about 34°; the grass follows
  // the latitude, the canopy only its deciduous share.
  const seasonal = smooth(24, 34, lat);
  if (seasonal === 0) return EVERGREEN;
  const canopy = seasonal * deciduousShare(latitudeDeg, longitudeDeg);
  // On the northern calendar: the southern year runs half a year behind.
  const d = latitudeDeg < 0 ? (((dayOfYear + 182.6) % 365.25) + 365.25) % 365.25 : dayOfYear;
  const up = leafOutDay(lat, heightM, climate.maritime);
  const peak = peakColourDay(lat, heightM, climate.maritime, climate.lateAutumnDays);
  // The year counted from two months before leaf-out, so an autumn that runs past 31 December
  // (a late one, in the warm south of the seasonal belt) carries on into January instead of
  // jumping back at New Year.
  const start = up - 60;
  const t = ((((d - start) % 365.25) + 365.25) % 365.25) + start;
  // Without hard frost the leaves come down slowly: a maritime autumn (London's planes in leaf
  // into late November) and southern Japan's (Kyoto's maples into mid-December) take weeks
  // longer to strip than a continental one, where the first frosts bring them down together.
  const mild = Math.max(climate.maritime, climate.lateAutumnDays >= 20 ? 0.6 : 0);
  const leafOn =
    smooth(up - 14, up + 14, t) * (1 - smooth(peak + 2 + 8 * mild, peak + 26 + 14 * mild, t));
  // The leaves turn over the month before the peak; once they are down it no longer matters.
  const autumn = smooth(peak - 32, peak - 3, t) * (t > up + 20 ? 1 : 0);
  // Grass greens a little before the trees leaf out and browns a little after they drop.
  const grass = smooth(up - 34, up - 6, t) * (1 - smooth(peak + 12, peak + 46, t));
  return {
    leafOn: round2(1 - canopy * (1 - leafOn)),
    autumn: round2(canopy * autumn),
    grassGreen: round2(1 - seasonal * GRASS_DORMANCY * (1 - 0.7 * climate.maritime) * (1 - grass)),
  };
}

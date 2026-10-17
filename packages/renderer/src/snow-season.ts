/**
 * Lying snow in the lowlands: the share of a place's ground covered on a day of the year, from
 * how long its winter snowpack lasts. The ground texture's snowline (`snowlineM`) is a mountain
 * rule, a line that climbs and falls with the seasons; on its own it left Montreal, Moscow,
 * Helsinki and Tromso green in February, where a photographer finds them white for months.
 *
 * A rule of thumb by region, not a climate map, and deliberately cautious: only a snowpack that
 * lasts (about two months or more at sea level) is painted, and only in the middle of its
 * season, because snow drawn where there is none misleads more than snow left out. Places whose
 * snow comes and goes (Boston, Chicago, Berlin, London) stay bare; the forecast's snow depth
 * still paints them inside its horizon (`snowlineWithForecast`).
 *
 * Season lengths at sea level, roughly from the snow-cover records:
 * - North America east of the Pacific ranges: none south of ~44 deg, about 3-4 months at
 *   Montreal (45.5 deg), 6 at Winnipeg, the whole winter in Alaska and the North; the chinook
 *   belt east of the Rockies keeps about half its latitude's season.
 * - Europe and western Asia: the Atlantic keeps the west bare (the British Isles, France, the
 *   Low Countries, Norway's west coast); Warsaw, Kyiv and the plains south of ~52 deg have snow
 *   that comes and goes in recent winters; Moscow about 4 months, the Baltic and Gulf of Finland
 *   shores (Stockholm, Helsinki, St Petersburg) 3-4, northern Scandinavia and Finland 6-7.
 * - East Asia: Hokkaido 4 months and more; elsewhere from about 45 deg (the north China plain,
 *   Korea and Honshu's Pacific side stay bare; Harbin is just in, Siberia all winter).
 * - The southern hemisphere has no lowland snowpack to speak of outside Antarctica (the ice
 *   sheet is painted by its own rule).
 * Height lengthens the season, about five days per 100 m above 200 m, where the latitude has a
 * winter for it to lengthen: in full from 45 deg, easing to nothing at 30 deg, so Denver,
 * Albuquerque and Kabul stay bare and the high cities of the tropics (Mexico City, Bogota,
 * Quito, Nairobi) are never painted white; their peaks keep the mountain snowline.
 */

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** The snowpack season's middle, northern day of the year (about 4 February). */
export const SNOW_SEASON_MIDDAY = 35;

/** Shorter seasons than this are snow that comes and goes: not painted. */
export const MIN_SNOWPACK_DAYS = 60;

/** How many days a year snow lies at sea level here, by region (see the module comment). */
export function snowSeasonDaysAtSeaLevel(latitudeDeg: number, longitudeDeg: number): number {
  const lat = latitudeDeg;
  const lon = ((((longitudeDeg + 180) % 360) + 360) % 360) - 180;
  if (lat <= 0) return 0;
  // North America (and Greenland's southern tip is ice, painted elsewhere).
  if (lon >= -170 && lon < -50) {
    // The Pacific coast inside the coast ranges (Vancouver, Seattle, Portland) and the
    // southeast Alaskan panhandle: wet, mild winters.
    const pacific = lat < 60 && lon > -135 && lon < -121 && lat > 40;
    if (pacific) return 0;
    const season = clamp((lat - 41) * 22, 0, 240);
    // East of the Rockies the chinook melts the snow time and again (Calgary, Great Falls).
    const chinook = lat > 45 && lat < 55 && lon > -116 && lon < -104 ? 0.55 : 1;
    // Alaska's south coast (Anchorage, the Kenai) melts out in April, the interior in May.
    const gulf = lat < 62.5 && lon < -140 ? 0.7 : 1;
    return season * chinook * gulf;
  }
  // Iceland and the Faroes: maritime, snow comes and goes at sea level.
  if (lon >= -25 && lon < -12) return 0;
  // Europe and western Asia.
  if (lon >= -12 && lon < 60) {
    const base = clamp((lat - 49) * 18, 0, 220);
    let maritime: number;
    if (lat < 57) maritime = 1 - smooth(2, 22, lon);
    else if (lon < 7)
      maritime = 1; // Norway's west coast
    else if (lon < 11 && lat < 62)
      maritime = 0.5; // Oslofjord, Skagerrak
    else maritime = 0;
    // The Baltic's open water shortens the season on its shores (Stockholm, Helsinki, Tallinn,
    // St Petersburg at the head of the Gulf of Finland).
    const baltic = lat >= 57 && lat < 62.5 && lon >= 14 && lon < 31 ? 0.65 : 1;
    return base * (1 - maritime) * baltic;
  }
  // East Asia: Hokkaido's sea-effect snow; elsewhere a continental rule.
  if (lat >= 41.5 && lat < 46 && lon >= 139 && lon < 146) return 125 + (lat - 41.5) * 10;
  if (lat < 46 && lon >= 128 && lon < 146) return 0; // Honshu, Kyushu, Korea's south
  return clamp((lat - 42) * 18, 0, 230);
}

/**
 * The share of the ground under lying snow, 0-1, at a latitude and longitude on a day of the
 * year, `heightM` metres above sea level: 1 through the middle of a lasting snowpack, easing to
 * 0 over about ten days at its ends; 0 where the snowpack does not last.
 */
export function lowlandSnowCover(
  latitudeDeg: number,
  longitudeDeg: number,
  dayOfYear: number,
  heightM = 0,
): number {
  // The southern hemisphere has no lowland snowpack (and this season's middle is February).
  if (latitudeDeg <= 0) return 0;
  const days =
    snowSeasonDaysAtSeaLevel(latitudeDeg, longitudeDeg) +
    (Math.max(0, heightM - 200) / 20) * smooth(30, 45, latitudeDeg);
  if (days < MIN_SNOWPACK_DAYS) return 0;
  // Only the reliable core: the season's ends vary by weeks from year to year.
  const core = Math.min(330, days - 20);
  const half = core / 2;
  // Distance from the season's middle in days, across New Year.
  const d = Math.abs(((((dayOfYear - SNOW_SEASON_MIDDAY) % 365.25) + 545.25) % 365.25) - 180);
  return Math.round((1 - smooth(half - 10, half + 10, d)) * 100) / 100;
}

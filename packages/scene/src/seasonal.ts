/**
 * The seasonal envelope of the Sun at a place (plan §1 "seasonal path", one of the deterministic
 * facts): where sunrise and sunset swing to over the year and how high noon gets, taken at the
 * two solstices, which bound every other day (between the tropics, the noon Sun's lowest only:
 * it passes overhead twice a year there). Pure astronomy — no weather, no terrain — so it
 * can be drawn on the compass rose and read in the details panel for any place, any year. The
 * 21st stands in for the solstice (which falls on the 20th–22nd): within 0.03° of bearing at
 * mid-latitudes, 0.2° near the Arctic circle, under the 1° the readout shows.
 */
import {
  computeDayEvents,
  julianCenturiesTT,
  solarEquatorial,
  sunPosition,
  utcToWallClock,
} from '@lightmap/astronomy';
import { compassLabel } from '@lightmap/geospatial';

export interface SolsticeDay {
  /** Civil date, YYYY-MM-DD. */
  date: string;
  /** Bearing of sunrise / sunset (degrees, 0 = north), null when the Sun does not rise or set. */
  sunriseAzimuthDeg: number | null;
  sunsetAzimuthDeg: number | null;
  /** Elevation at solar noon, degrees. */
  noonElevationDeg: number;
  daylightMinutes: number;
  polar: 'normal' | 'midnight-sun' | 'polar-night';
}

export interface SeasonalEnvelope {
  /** The June solstice (summer north of the equator). */
  june: SolsticeDay;
  /** The December solstice. */
  december: SolsticeDay;
  /**
   * The year's sunrise bearings run from `sunriseRange[0]` to `sunriseRange[1]` clockwise
   * (likewise sunset); null when the Sun does not rise on one of the solstices.
   */
  sunriseRange: [number, number] | null;
  sunsetRange: [number, number] | null;
  /** Lowest and highest noon of the year, degrees. */
  noonRange: [number, number];
  /**
   * Between the tropics, the civil dates (YYYY-MM-DD, in the zone) on which the noon Sun passes
   * closest to the zenith - shadowless noons; one on a tropic, none outside.
   */
  overheadDates: string[];
}

function solstice(
  point: { latitude: number; longitude: number },
  timeZone: string,
  year: number,
  month: 6 | 12,
): SolsticeDay {
  const day = 21;
  const ev = computeDayEvents({
    latitude: point.latitude,
    longitude: point.longitude,
    timeZone,
    date: { year, month, day },
  });
  const azAt = (t: Date | null) =>
    t ? sunPosition(t, point.latitude, point.longitude).azimuthDeg : null;
  // The transit itself where there is one (the day's sampled maximum sits up to 0.3° under it).
  const noon = ev.solarNoon
    ? sunPosition(ev.solarNoon, point.latitude, point.longitude).elevationDeg
    : ev.maxElevationDeg;
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${day}`,
    sunriseAzimuthDeg: azAt(ev.sunrise),
    sunsetAzimuthDeg: azAt(ev.sunset),
    noonElevationDeg: noon,
    daylightMinutes: ev.daylightMinutes,
    polar: ev.polar,
  };
}

/** Clockwise range from a to b on the compass, ordered so the sweep is the shorter arc. */
function range(a: number | null, b: number | null): [number, number] | null {
  if (a === null || b === null) return null;
  const d = (((b - a) % 360) + 360) % 360;
  return d <= 180 ? [a, b] : [b, a];
}

/** The tropics' latitude (the Earth's tilt, to the precision a noon height is printed). */
const TROPIC_DEG = 23.44;

/**
 * The days of the year the noon Sun stands highest between the tropics: local maxima of the
 * noon height over the year (from the Sun's declination each day), within half a degree of the
 * zenith. Two dates where the Sun crosses the latitude twice; one on a tropic, and one where the
 * Capricorn summer's other crossing falls in the next (or last) calendar year.
 */
function overheadNoons(
  point: { latitude: number; longitude: number },
  timeZone: string,
  year: number,
): string[] {
  if (Math.abs(point.latitude) >= TROPIC_DEG + 0.05) return [];
  const start = Date.UTC(year, 0, 1, 12) - (point.longitude / 15) * 3_600_000;
  // The noon height from the Sun's declination (90° less its distance from the latitude), so
  // the equation of time's quarter hour does not shave degrees off it. A few days either side of
  // the year, not wrapped round, so a peak on 1 January or 31 December is judged against its
  // true neighbours; only the dates inside the year asked for are kept.
  const noonAt = (d: number) => start + d * 86_400_000;
  const height = (d: number) =>
    90 -
    Math.abs(
      point.latitude - solarEquatorial(julianCenturiesTT(new Date(noonAt(d)))).declinationDeg,
    );
  const out: string[] = [];
  let prev = height(-3);
  let cur = height(-2);
  for (let d = -2; d <= 368; d++) {
    const next = height(d + 1);
    if (cur >= prev && cur > next && cur > 89.5) {
      const w = utcToWallClock(new Date(noonAt(d)), timeZone);
      const date = `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
      if (w.year === year && !out.includes(date)) out.push(date);
    }
    prev = cur;
    cur = next;
  }
  return out;
}

/** The year's sunrise/sunset bearings and noon heights at a place, bounded by its two solstices. */
export function seasonalEnvelope(
  point: { latitude: number; longitude: number },
  timeZone: string,
  year: number,
): SeasonalEnvelope {
  const june = solstice(point, timeZone, year, 6);
  const december = solstice(point, timeZone, year, 12);
  // Between the tropics the noon Sun passes overhead on two days between the solstices, which
  // bound only its lowest noon there.
  const tropics = Math.abs(point.latitude) < TROPIC_DEG;
  const noons: [number, number] = [
    Math.min(june.noonElevationDeg, december.noonElevationDeg),
    tropics ? 90 : Math.max(june.noonElevationDeg, december.noonElevationDeg),
  ];
  return {
    june,
    december,
    sunriseRange: range(june.sunriseAzimuthDeg, december.sunriseAzimuthDeg),
    sunsetRange: range(june.sunsetAzimuthDeg, december.sunsetAzimuthDeg),
    noonRange: noons,
    overheadDates: tropics ? overheadNoons(point, timeZone, year) : [],
  };
}

/** Clockwise angular width of a range, degrees. */
export function rangeWidthDeg(r: [number, number]): number {
  return (((r[1] - r[0]) % 360) + 360) % 360;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-05-26" -> "26 May". */
function dayMonth(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`;
}

/** "64°–115° (ENE–ESE)" for a clockwise bearing range. */
export function formatBearingRange(r: [number, number]): string {
  return `${Math.round(r[0])}°–${Math.round(r[1])}° (${compassLabel(r[0])}–${compassLabel(r[1])})`;
}

/**
 * One line on where sunrise and sunset swing to over the year, and how high noon gets. Where a
 * solstice has no sunrise (midnight sun, polar night) its condition is named and the other
 * solstice's bearings are given on their own.
 */
export function describeSeasonalEnvelope(e: SeasonalEnvelope): string {
  const overhead = e.overheadDates.map(dayMonth).join(' and ');
  const noon = `noon ${Math.round(e.noonRange[0])}°–${Math.round(e.noonRange[1])}°${overhead ? ` (overhead ${overhead})` : ''}`;
  if (e.sunriseRange && e.sunsetRange)
    return `Sunrise ${formatBearingRange(e.sunriseRange)}, sunset ${formatBearingRange(e.sunsetRange)}, ${noon}`;
  const parts: string[] = [];
  for (const [name, d] of [
    ['June', e.june],
    ['December', e.december],
  ] as const) {
    if (d.polar !== 'normal') parts.push(`${name}: ${d.polar.replace('-', ' ')}`);
    else if (d.sunriseAzimuthDeg !== null && d.sunsetAzimuthDeg !== null)
      parts.push(
        `${name}: sunrise ${Math.round(d.sunriseAzimuthDeg)}° (${compassLabel(d.sunriseAzimuthDeg)}), sunset ${Math.round(d.sunsetAzimuthDeg)}° (${compassLabel(d.sunsetAzimuthDeg)})`,
      );
  }
  return parts.length ? `${parts.join('; ')}; ${noon}` : noon;
}

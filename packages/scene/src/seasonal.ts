/**
 * The seasonal envelope of the Sun at a place (plan §1 "seasonal path", one of the deterministic
 * facts): where sunrise and sunset swing to over the year and how high noon gets, taken at the
 * two solstices, which bound every other day. Pure astronomy — no weather, no terrain — so it
 * can be drawn on the compass rose and read in the details panel for any place, any year. The
 * 21st stands in for the solstice (which falls on the 20th–22nd): within 0.03° of bearing at
 * mid-latitudes, 0.2° near the Arctic circle, under the 1° the readout shows.
 */
import { computeDayEvents, sunPosition } from '@lightmap/astronomy';
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

/** The year's sunrise/sunset bearings and noon heights at a place, bounded by its two solstices. */
export function seasonalEnvelope(
  point: { latitude: number; longitude: number },
  timeZone: string,
  year: number,
): SeasonalEnvelope {
  const june = solstice(point, timeZone, year, 6);
  const december = solstice(point, timeZone, year, 12);
  const noons: [number, number] = [
    Math.min(june.noonElevationDeg, december.noonElevationDeg),
    Math.max(june.noonElevationDeg, december.noonElevationDeg),
  ];
  return {
    june,
    december,
    sunriseRange: range(june.sunriseAzimuthDeg, december.sunriseAzimuthDeg),
    sunsetRange: range(june.sunsetAzimuthDeg, december.sunsetAzimuthDeg),
    noonRange: noons,
  };
}

/** Clockwise angular width of a range, degrees. */
export function rangeWidthDeg(r: [number, number]): number {
  return (((r[1] - r[0]) % 360) + 360) % 360;
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
  const noon = `noon ${Math.round(e.noonRange[0])}°–${Math.round(e.noonRange[1])}°`;
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

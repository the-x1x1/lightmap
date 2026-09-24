/**
 * Day events: rise, set, transit, twilight and the photographer's windows (golden hour, blue hour).
 *
 * Method: sample the Sun's geometric elevation across the local civil day (from local midnight
 * to the next local midnight, so the answer is "the events of this calendar date at this place",
 * which is what a photographer means), find sign changes against each threshold, and refine
 * each crossing by bisection to < 1 s. Transit is found the same way on the hour angle. This
 * is slower than the classical one-shot formula but it is correct at every latitude, needs no
 * special cases for polar day/night, and reports *why* an event is missing.
 *
 * Thresholds (geometric elevation of the Sun's centre):
 *   rise/set           −0.833°  (34′ standard refraction + 16′ semidiameter)
 *   civil twilight     −6°
 *   nautical twilight  −12°
 *   astronomical       −18°
 *   golden hour         −4° … +6°  (common photographic definition; configurable)
 *   blue hour           −6° … −4°
 */
import { sunPosition } from './solar.ts';
import { localDayBounds, type CivilTime } from './time.ts';

export const THRESHOLDS = {
  horizon: -0.833,
  civil: -6,
  nautical: -12,
  astronomical: -18,
  goldenLow: -4,
  goldenHigh: 6,
} as const;

export type PolarCondition = 'normal' | 'midnight-sun' | 'polar-night';

export interface DayEvents {
  /** Civil date these events belong to. */
  date: string;
  timeZone: string;
  /** UTC instants; null when the event does not occur on this date at this place. */
  astronomicalDawn: Date | null;
  nauticalDawn: Date | null;
  dawn: Date | null;
  sunrise: Date | null;
  goldenHourMorningStart: Date | null;
  goldenHourMorningEnd: Date | null;
  solarNoon: Date | null;
  goldenHourEveningStart: Date | null;
  goldenHourEveningEnd: Date | null;
  sunset: Date | null;
  civilDusk: Date | null;
  nauticalDusk: Date | null;
  astronomicalDusk: Date | null;
  /** Solar midnight (lower transit) when it falls inside the day. */
  solarMidnight: Date | null;
  /** Elevation at solar noon and midnight, degrees. */
  maxElevationDeg: number;
  minElevationDeg: number;
  /** Whether the Sun stays above the horizon (midnight sun) or below it (polar night) all day. */
  polar: PolarCondition;
  /** Human-readable explanation for missing events (USNO-style wording). */
  notes: string[];
  /** Day length in minutes between sunrise and sunset; 1440 for midnight sun; 0 for polar night. */
  daylightMinutes: number;
  /** Local-day bounds in UTC. */
  dayStart: Date;
  dayEnd: Date;
}

interface Sample {
  t: number;
  elev: number;
  hourAngle: number;
}

const STEP_MS = 10 * 60_000;

function sampleDay(start: Date, end: Date, lat: number, lon: number): Sample[] {
  const out: Sample[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += STEP_MS) {
    const p = sunPosition(new Date(t), lat, lon);
    out.push({ t, elev: p.elevationDeg, hourAngle: p.hourAngleDeg });
  }
  const last = out[out.length - 1];
  if (last && last.t < end.getTime()) {
    const p = sunPosition(end, lat, lon);
    out.push({ t: end.getTime(), elev: p.elevationDeg, hourAngle: p.hourAngleDeg });
  }
  return out;
}

/** Bisection for elevation(t) = threshold between two bracketing times. */
function refineCrossing(
  t0: number,
  t1: number,
  threshold: number,
  lat: number,
  lon: number,
): number {
  let a = t0;
  let b = t1;
  let fa = sunPosition(new Date(a), lat, lon).elevationDeg - threshold;
  for (let i = 0; i < 40 && b - a > 500; i++) {
    const m = (a + b) / 2;
    const fm = sunPosition(new Date(m), lat, lon).elevationDeg - threshold;
    if ((fa < 0 && fm < 0) || (fa >= 0 && fm >= 0)) {
      a = m;
      fa = fm;
    } else {
      b = m;
    }
  }
  return Math.round((a + b) / 2 / 1000) * 1000;
}

/** First crossing of `threshold` in the given direction: 'up' (elev rising through) or 'down'. */
function findCrossing(
  samples: Sample[],
  threshold: number,
  direction: 'up' | 'down',
  lat: number,
  lon: number,
): Date | null {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const aBelow = a.elev < threshold;
    const bBelow = b.elev < threshold;
    if (direction === 'up' && aBelow && !bBelow)
      return new Date(refineCrossing(a.t, b.t, threshold, lat, lon));
    if (direction === 'down' && !aBelow && bBelow)
      return new Date(refineCrossing(a.t, b.t, threshold, lat, lon));
  }
  return null;
}

/** Hour angle passes through 0 (upper transit) or ±180 (lower transit). */
function findTransit(
  samples: Sample[],
  kind: 'upper' | 'lower',
  lat: number,
  lon: number,
): Date | null {
  const target = (h: number) => (kind === 'upper' ? h : h >= 0 ? h - 180 : h + 180);
  for (let i = 1; i < samples.length; i++) {
    const a = target(samples[i - 1]!.hourAngle);
    const b = target(samples[i]!.hourAngle);
    if (a < 0 && b >= 0 && b - a < 180) {
      // bisection on the hour angle
      let lo = samples[i - 1]!.t;
      let hi = samples[i]!.t;
      for (let k = 0; k < 40 && hi - lo > 500; k++) {
        const m = (lo + hi) / 2;
        const hm = target(sunPosition(new Date(m), lat, lon).hourAngleDeg);
        if (hm < 0) lo = m;
        else hi = m;
      }
      return new Date(Math.round((lo + hi) / 2 / 1000) * 1000);
    }
  }
  return null;
}

export interface DayEventInput {
  latitude: number;
  longitude: number;
  date: Pick<CivilTime, 'year' | 'month' | 'day'>;
  timeZone: string;
}

export function computeDayEvents(input: DayEventInput): DayEvents {
  const { latitude: lat, longitude: lon, timeZone } = input;
  const { start, end } = localDayBounds(input.date, timeZone);
  const samples = sampleDay(start, end, lat, lon);
  const elevations = samples.map((s) => s.elev);
  const maxElevationDeg = Math.max(...elevations);
  const minElevationDeg = Math.min(...elevations);
  const notes: string[] = [];

  const sunrise = findCrossing(samples, THRESHOLDS.horizon, 'up', lat, lon);
  const sunset = findCrossing(samples, THRESHOLDS.horizon, 'down', lat, lon);
  const dawn = findCrossing(samples, THRESHOLDS.civil, 'up', lat, lon);
  const civilDusk = findCrossing(samples, THRESHOLDS.civil, 'down', lat, lon);
  const nauticalDawn = findCrossing(samples, THRESHOLDS.nautical, 'up', lat, lon);
  const nauticalDusk = findCrossing(samples, THRESHOLDS.nautical, 'down', lat, lon);
  const astronomicalDawn = findCrossing(samples, THRESHOLDS.astronomical, 'up', lat, lon);
  const astronomicalDusk = findCrossing(samples, THRESHOLDS.astronomical, 'down', lat, lon);
  const goldenHourMorningStart = findCrossing(samples, THRESHOLDS.goldenLow, 'up', lat, lon);
  const goldenHourMorningEnd = findCrossing(samples, THRESHOLDS.goldenHigh, 'up', lat, lon);
  const goldenHourEveningStart = findCrossing(samples, THRESHOLDS.goldenHigh, 'down', lat, lon);
  const goldenHourEveningEnd = findCrossing(samples, THRESHOLDS.goldenLow, 'down', lat, lon);
  const solarNoon = findTransit(samples, 'upper', lat, lon);
  const solarMidnight = findTransit(samples, 'lower', lat, lon);

  let polar: PolarCondition = 'normal';
  if (minElevationDeg > THRESHOLDS.horizon && sunrise === null && sunset === null) {
    polar = 'midnight-sun';
    notes.push('Sun continuously above the horizon');
  } else if (maxElevationDeg < THRESHOLDS.horizon && sunrise === null && sunset === null) {
    polar = 'polar-night';
    notes.push('Sun continuously below the horizon');
    if (maxElevationDeg < THRESHOLDS.civil) notes.push('No civil twilight');
    if (maxElevationDeg < THRESHOLDS.nautical) notes.push('No nautical twilight');
    if (maxElevationDeg < THRESHOLDS.astronomical) notes.push('Continuous astronomical night');
  }
  if (polar === 'midnight-sun' && minElevationDeg > THRESHOLDS.goldenHigh)
    notes.push('No golden hour: the Sun never drops below 6°');
  if (polar === 'normal' && minElevationDeg > THRESHOLDS.civil)
    notes.push('No true night: civil twilight persists through the night');
  else if (polar === 'normal' && minElevationDeg > THRESHOLDS.astronomical)
    notes.push('No astronomical darkness tonight');

  let daylightMinutes: number;
  if (polar === 'midnight-sun') daylightMinutes = (end.getTime() - start.getTime()) / 60_000;
  else if (polar === 'polar-night') daylightMinutes = 0;
  else {
    const riseT = sunrise?.getTime() ?? start.getTime();
    const setT = sunset?.getTime() ?? end.getTime();
    daylightMinutes = Math.max(0, (setT - riseT) / 60_000);
  }

  return {
    date: `${input.date.year.toString().padStart(4, '0')}-${input.date.month.toString().padStart(2, '0')}-${input.date.day.toString().padStart(2, '0')}`,
    timeZone,
    astronomicalDawn,
    nauticalDawn,
    dawn,
    sunrise,
    goldenHourMorningStart,
    goldenHourMorningEnd,
    solarNoon,
    goldenHourEveningStart,
    goldenHourEveningEnd,
    sunset,
    civilDusk,
    nauticalDusk,
    astronomicalDusk,
    solarMidnight,
    maxElevationDeg,
    minElevationDeg,
    polar,
    notes,
    daylightMinutes,
    dayStart: start,
    dayEnd: end,
  };
}

export type LightPhase =
  | 'night'
  | 'astronomical-twilight'
  | 'nautical-twilight'
  | 'civil-twilight'
  | 'blue-hour'
  | 'golden-hour'
  | 'day';

/**
 * Classify a solar elevation into the photographer's phase. Blue hour sits inside civil twilight
 * (−6° … −4°); golden hour spans the horizon (−4° … +6°) so it covers sunrise/sunset themselves.
 */
export function lightPhase(elevationDeg: number): LightPhase {
  if (elevationDeg >= THRESHOLDS.goldenHigh) return 'day';
  if (elevationDeg >= THRESHOLDS.goldenLow) return 'golden-hour';
  if (elevationDeg >= THRESHOLDS.civil) return 'blue-hour';
  if (elevationDeg >= THRESHOLDS.nautical) return 'nautical-twilight';
  if (elevationDeg >= THRESHOLDS.astronomical) return 'astronomical-twilight';
  return 'night';
}

/** Twilight band as the plan names them (§10), for the UI and the colour-temperature curve. */
export function twilightBand(
  elevationDeg: number,
): 'day' | 'civil' | 'nautical' | 'astronomical' | 'night' {
  if (elevationDeg >= THRESHOLDS.horizon) return 'day';
  if (elevationDeg >= THRESHOLDS.civil) return 'civil';
  if (elevationDeg >= THRESHOLDS.nautical) return 'nautical';
  if (elevationDeg >= THRESHOLDS.astronomical) return 'astronomical';
  return 'night';
}

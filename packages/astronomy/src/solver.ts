/**
 * Reverse planning (plan §26): "I want the sun *there* — when does that happen?"
 *
 * Given a viewpoint and a target direction (compass azimuth, optional elevation), scan a range
 * of civil dates and return every instant at which the Sun (or Moon) sits at that azimuth, with
 * the elevation it has at that moment. Callers filter by elevation tolerance to answer questions
 * such as "sun setting behind that ridge" (target elevation = the ridge's elevation angle from the
 * camera) or "full moon rising over the bay" (body = moon, minimum illumination).
 *
 * Method: per civil day, sample the body's azimuth every 10 minutes, detect where the wrapped
 * difference to the target changes sign (ignoring the ±180° discontinuity), refine each crossing by
 * bisection to ~1 s, then evaluate elevation and phase at the refined instant. Sampling is the
 * same technique the day-event code uses, for the same reason: it is correct at every latitude,
 * including the tropics (where azimuth can cross a value several times a day) and polar summer
 * (where the Sun circles the horizon).
 *
 * Cost: ~145 evaluations per day; a full year of Sun matches takes a few milliseconds.
 * Pure: no I/O, no Date.now().
 */
import { moonPosition } from './lunar.ts';
import { sunPosition } from './solar.ts';
import { addCivilDays, civilDateString, localDayBounds, type CivilTime } from './time.ts';

export type CelestialBody = 'sun' | 'moon';

export interface DirectionTarget {
  /** Compass azimuth of the desired body position, degrees clockwise from north. */
  azimuthDegrees: number;
  /** Desired geometric elevation, degrees. Omit to accept any elevation above `minElevationDegrees`. */
  elevationDegrees?: number;
  /** Half-width of the accepted azimuth band (default 2°). */
  azimuthToleranceDegrees?: number;
  /** Half-width of the accepted elevation band when `elevationDegrees` is set (default 1°). */
  elevationToleranceDegrees?: number;
}

export interface SolverInput {
  latitude: number;
  longitude: number;
  timeZone: string;
  /** Inclusive civil date range at the location. */
  from: Pick<CivilTime, 'year' | 'month' | 'day'>;
  to: Pick<CivilTime, 'year' | 'month' | 'day'>;
  target: DirectionTarget;
  body?: CelestialBody;
  /**
   * Ignore instants where the body is below this geometric elevation (default −0.833°, i.e. it
   * must be at least apparently on the horizon). Set lower to include twilight alignments.
   */
  minElevationDegrees?: number;
  /** Moon only: skip instants when the illuminated fraction is below this (0–1). */
  minIlluminatedFraction?: number;
  /** Safety cap on scanned days (default 1100 ≈ 3 years). */
  maxDays?: number;
}

export interface DirectionMatch {
  /** Civil date at the location. */
  date: string;
  /**
   * How the instant was found: the body crossing the target azimuth ('azimuth'), or — when a
   * target elevation is given — the body crossing that elevation while inside the azimuth band
   * ('elevation'). Both kinds are exact instants; the tolerances decide which count as matches.
   */
  via: 'azimuth' | 'elevation';
  timestampUtc: Date;
  body: CelestialBody;
  azimuthDegrees: number;
  /** Geometric elevation at the instant of azimuth alignment. */
  elevationDegrees: number;
  /** Signed elevation error vs the target (null when no target elevation). */
  elevationErrorDegrees: number | null;
  /** True when the instant satisfies every tolerance in the target. */
  withinTolerance: boolean;
  /** Moon only. */
  illuminatedFraction: number | null;
  /** Rising (elevation increasing) or setting at the instant. */
  trend: 'rising' | 'setting';
}

export interface SolverResult {
  /** All azimuth alignments in the range that pass `minElevationDegrees` (and illumination), in time order. */
  alignments: DirectionMatch[];
  /** Subset of `alignments` that also satisfy the elevation tolerance (== alignments when no target elevation). */
  matches: DirectionMatch[];
  scannedDays: number;
  truncated: boolean;
}

const STEP_MS = 10 * 60_000;

/** Wrap an angle difference to (−180, 180]. */
export function wrapDelta(deg: number): number {
  let d = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

function positionOf(body: CelestialBody, t: number, lat: number, lon: number) {
  if (body === 'moon') {
    const m = moonPosition(new Date(t), lat, lon);
    return {
      azimuth: m.azimuthDeg,
      elevation: m.topocentricElevationDeg,
      illuminated: m.illuminatedFraction,
    };
  }
  const s = sunPosition(new Date(t), lat, lon);
  return { azimuth: s.azimuthDeg, elevation: s.elevationDeg, illuminated: null };
}

/** Bisection on a signed function between two instants that bracket a sign change. */
function refineCrossing(f: (t: number) => number, a: number, b: number, fa: number): number {
  let lo = a;
  let hi = b;
  let flo = fa;
  for (let i = 0; i < 40 && hi - lo > 500; i++) {
    const m = (lo + hi) / 2;
    const fm = f(m);
    if ((flo < 0 && fm < 0) || (flo >= 0 && fm >= 0)) {
      lo = m;
      flo = fm;
    } else {
      hi = m;
    }
  }
  return Math.round((lo + hi) / 2 / 1000) * 1000;
}

function civilCompare(
  a: Pick<CivilTime, 'year' | 'month' | 'day'>,
  b: Pick<CivilTime, 'year' | 'month' | 'day'>,
): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Find every instant in the date range at which the body's azimuth equals the target azimuth.
 * See the module comment for semantics.
 */
export function findDirectionMatches(input: SolverInput): SolverResult {
  const body = input.body ?? 'sun';
  const { latitude: lat, longitude: lon, timeZone } = input;
  const targetAz = ((input.target.azimuthDegrees % 360) + 360) % 360;
  const azTol = input.target.azimuthToleranceDegrees ?? 2;
  const elTarget = input.target.elevationDegrees;
  const elTol = input.target.elevationToleranceDegrees ?? 1;
  const minEl = input.minElevationDegrees ?? -0.833;
  const minIllum = input.minIlluminatedFraction ?? 0;
  const maxDays = input.maxDays ?? 1100;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90)
    throw new RangeError('invalid coordinates');
  if (civilCompare(input.from, input.to) > 0) throw new RangeError('from is after to');

  const alignments: DirectionMatch[] = [];
  let day = { year: input.from.year, month: input.from.month, day: input.from.day };
  let scanned = 0;
  let truncated = false;
  const azOf = (t: number) => wrapDelta(positionOf(body, t, lat, lon).azimuth - targetAz);
  const elOf = (t: number) => positionOf(body, t, lat, lon).elevation - (elTarget ?? 0);

  const record = (dayKey: string, tc: number, via: DirectionMatch['via']) => {
    const p = positionOf(body, tc, lat, lon);
    if (p.elevation < minEl || (p.illuminated ?? 1) < minIllum) return;
    // The two detectors can find the same instant (body crossing the bearing exactly at the
    // target elevation); keep one.
    const dup = alignments.find(
      (a) => a.date === dayKey && Math.abs(a.timestampUtc.getTime() - tc) < 2 * 60_000,
    );
    if (dup) return;
    const after = positionOf(body, tc + 60_000, lat, lon).elevation;
    const elErr = elTarget === undefined ? null : p.elevation - elTarget;
    const within =
      Math.abs(wrapDelta(p.azimuth - targetAz)) <= azTol &&
      (elErr === null || Math.abs(elErr) <= elTol);
    alignments.push({
      date: dayKey,
      via,
      timestampUtc: new Date(tc),
      body,
      azimuthDegrees: p.azimuth,
      elevationDegrees: p.elevation,
      elevationErrorDegrees: elErr,
      withinTolerance: within,
      illuminatedFraction: p.illuminated,
      trend: after >= p.elevation ? 'rising' : 'setting',
    });
  };

  while (civilCompare(day, input.to) <= 0) {
    if (scanned >= maxDays) {
      truncated = true;
      break;
    }
    scanned++;
    const dayKey = civilDateString(day);
    const { start, end } = localDayBounds(day, timeZone);
    const dayStart = start.getTime();
    const dayEnd = end.getTime();
    let prevT = dayStart;
    let prevAz = azOf(prevT);
    let prevEl = elTarget === undefined ? 0 : elOf(prevT);
    for (let t = prevT + STEP_MS; t <= dayEnd; t += STEP_MS) {
      const curAz = azOf(t);
      // Azimuth crossing: sign change of the wrapped difference. The ±180° wrap also flips sign,
      // but with a jump of (360° − true swing) > 180°, whereas a true swing — even the near-zenith
      // sweep in the tropics — is ≤ 180°.
      const crossesAz = (prevAz < 0 && curAz >= 0) || (prevAz >= 0 && curAz < 0);
      if (crossesAz && Math.abs(curAz - prevAz) < 180)
        record(dayKey, refineCrossing(azOf, prevT, t, prevAz), 'azimuth');
      // Elevation crossing inside the azimuth band: "anywhere between 265° and 275° at −0.8°".
      if (elTarget !== undefined) {
        const curEl = elOf(t);
        const crossesEl = (prevEl < 0 && curEl >= 0) || (prevEl >= 0 && curEl < 0);
        if (crossesEl) {
          const tc = refineCrossing(elOf, prevT, t, prevEl);
          if (Math.abs(azOf(tc)) <= azTol) record(dayKey, tc, 'elevation');
        }
        prevEl = curEl;
      }
      prevT = t;
      prevAz = curAz;
    }
    alignments.sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());
    day = addCivilDays(day, 1);
  }

  return {
    alignments,
    matches: alignments.filter((m) => m.withinTolerance),
    scannedDays: scanned,
    truncated,
  };
}

/**
 * Convenience for the common photographic question: at what elevation is the body when it is at
 * this azimuth on each day? Returns one entry per alignment (days without an alignment are absent).
 */
export function elevationAtAzimuthByDay(
  input: Omit<SolverInput, 'target'> & { azimuthDegrees: number },
): Array<{
  date: string;
  elevationDegrees: number;
  timestampUtc: Date;
  trend: 'rising' | 'setting';
}> {
  const r = findDirectionMatches({
    ...input,
    target: { azimuthDegrees: input.azimuthDegrees, azimuthToleranceDegrees: 180 },
    minElevationDegrees: input.minElevationDegrees ?? -90,
  });
  return r.alignments.map((a) => ({
    date: a.date,
    elevationDegrees: a.elevationDegrees,
    timestampUtc: a.timestampUtc,
    trend: a.trend,
  }));
}

export interface RecurrenceSummary<T extends { date: string }> {
  /**
   * Last civil date (inclusive) of the unbroken run of matching days that starts at `from`, or
   * null when `from` itself has no match — the light the photographer is looking at ends with the
   * current day. Near a solstice the run lasts weeks (declination is nearly stationary); near an
   * equinox it is a day or two.
   */
  runEnds: string | null;
  /** First match after that run — "when this light comes back" — or null when none is in range. */
  next: T | null;
  /** Distinct matching civil days in the range. */
  matchingDays: number;
}

/**
 * Turn a chronologically sorted match list into the two facts a photographer wants about "this
 * light": how long it lasts (the run of consecutive matching days from `from`) and when it comes
 * back after that (the first match after the run). Works on `DirectionMatch` and on serialized
 * matches alike: only `date` is read.
 */
export function summarizeRecurrence<T extends { date: string }>(
  matches: readonly T[],
  from: Pick<CivilTime, 'year' | 'month' | 'day'>,
): RecurrenceSummary<T> {
  const days = new Set(matches.map((m) => m.date));
  let runEnds: string | null = null;
  let day = { year: from.year, month: from.month, day: from.day };
  // Bounded by the number of matching days, so a malformed input cannot loop forever.
  for (let i = 0; i <= days.size && days.has(civilDateString(day)); i++) {
    runEnds = civilDateString(day);
    day = addCivilDays(day, 1);
  }
  const floor = runEnds ?? civilDateString(addCivilDays(from, -1));
  const next = matches.find((m) => m.date > floor) ?? null;
  return { runEnds, next, matchingDays: days.size };
}

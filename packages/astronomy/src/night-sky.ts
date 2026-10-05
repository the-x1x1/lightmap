/**
 * Night-sky planning (plan §38 "moon/night planning"): where the Milky Way's core — the Galactic
 * Centre, the bright bulge in Sagittarius every night-landscape photographer frames — stands,
 * and whether the sky is dark enough to show it. Deterministic: a fixed J2000 direction
 * precessed to the date (Meeus ch. 21), the observer's sidereal time, the Sun's depth below the
 * horizon and the Moon's state. Not a sky-brightness model: light pollution, airglow and haze are
 * the photographer's to judge.
 */
import { moonHorizonThresholdDeg, moonPosition } from './lunar.ts';
import { sunPosition, toHorizontal, type HorizontalCoordinates } from './solar.ts';
import { formatWallTime, julianCenturiesTT, utcToWallClock } from './time.ts';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Galactic Centre (Sgr A*), ICRS/J2000: 17h 45m 40.04s, −29° 00′ 28.1″. */
export const GALACTIC_CENTRE_J2000 = { rightAscensionDeg: 266.416_83, declinationDeg: -29.007_81 };

/**
 * Precess J2000 equatorial coordinates to the mean equinox of date (Meeus 21.3–21.4; the
 * rigorous rotation, good to a few arcseconds over a century).
 */
export function precessFromJ2000(
  rightAscensionDeg: number,
  declinationDeg: number,
  T: number,
): { rightAscensionDeg: number; declinationDeg: number } {
  const arcsec = 1 / 3600;
  const zeta = (2306.2181 * T + 0.301_88 * T * T + 0.017_998 * T * T * T) * arcsec * DEG;
  const z = (2306.2181 * T + 1.094_68 * T * T + 0.018_203 * T * T * T) * arcsec * DEG;
  const theta = (2004.3109 * T - 0.426_65 * T * T - 0.041_833 * T * T * T) * arcsec * DEG;
  const a0 = rightAscensionDeg * DEG;
  const d0 = declinationDeg * DEG;
  const A = Math.cos(d0) * Math.sin(a0 + zeta);
  const B = Math.cos(theta) * Math.cos(d0) * Math.cos(a0 + zeta) - Math.sin(theta) * Math.sin(d0);
  const C = Math.sin(theta) * Math.cos(d0) * Math.cos(a0 + zeta) + Math.cos(theta) * Math.sin(d0);
  const ra = ((Math.atan2(A, B) + z) * RAD + 360) % 360;
  const dec = Math.asin(Math.max(-1, Math.min(1, C))) * RAD;
  return { rightAscensionDeg: ra, declinationDeg: dec };
}

/** Where the Galactic Centre stands for an observer: azimuth from north, geometric elevation. */
export function galacticCentrePosition(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): HorizontalCoordinates {
  const eq = precessFromJ2000(
    GALACTIC_CENTRE_J2000.rightAscensionDeg,
    GALACTIC_CENTRE_J2000.declinationDeg,
    julianCenturiesTT(date),
  );
  return toHorizontal(eq, date, latitudeDeg, longitudeDeg);
}

export type MilkyWayVerdict =
  'visible' | 'low' | 'below-horizon' | 'twilight' | 'moonlit' | 'daylight';

export interface MilkyWayCoreState {
  azimuthDeg: number;
  elevationDeg: number;
  sunElevationDeg: number;
  moonUp: boolean;
  moonIlluminatedFraction: number;
  /** The practical answer: the core is up and the sky can be dark enough to show it. */
  verdict: MilkyWayVerdict;
  /** One line a photographer can act on. */
  reason: string;
}

/** Below this elevation the core sits in the thickest, brightest air and rarely shows well. */
export const MILKY_WAY_LOW_ELEVATION_DEG = 10;
/** A Moon brighter than this, above the horizon, washes the band out. */
export const MILKY_WAY_MOON_LIMIT = 0.3;

/**
 * The verdict from already-known pieces (the scene has the Sun and Moon in hand). Order of the
 * tests is the order a photographer would rule things out: daylight, twilight, core below the
 * horizon, Moon, then low altitude.
 */
export function milkyWayCoreFrom(
  core: Pick<HorizontalCoordinates, 'azimuthDeg' | 'elevationDeg'>,
  sunElevationDeg: number,
  moonUp: boolean,
  moonIlluminatedFraction: number,
): MilkyWayCoreState {
  const base = {
    azimuthDeg: core.azimuthDeg,
    elevationDeg: core.elevationDeg,
    sunElevationDeg,
    moonUp,
    moonIlluminatedFraction,
  };
  if (sunElevationDeg > -6)
    return { ...base, verdict: 'daylight', reason: 'Daylight or civil twilight: no stars' };
  if (sunElevationDeg > -18)
    return {
      ...base,
      verdict: 'twilight',
      reason: `Twilight (Sun ${sunElevationDeg.toFixed(0)}°): the band needs astronomical night`,
    };
  if (core.elevationDeg <= 0)
    return { ...base, verdict: 'below-horizon', reason: 'Galactic core below the horizon' };
  if (moonUp && moonIlluminatedFraction > MILKY_WAY_MOON_LIMIT)
    return {
      ...base,
      verdict: 'moonlit',
      reason: `Moon up and ${Math.round(moonIlluminatedFraction * 100)} % lit: the sky is too bright`,
    };
  if (core.elevationDeg < MILKY_WAY_LOW_ELEVATION_DEG)
    return {
      ...base,
      verdict: 'low',
      reason: `Core only ${core.elevationDeg.toFixed(0)}° up: in haze near the horizon`,
    };
  return {
    ...base,
    verdict: 'visible',
    reason: `Astronomical night, core ${core.elevationDeg.toFixed(0)}° up${moonUp ? ', thin Moon' : ', Moon down'}`,
  };
}

/** Whether the Milky Way core can be photographed from here at this instant. */
export function milkyWayCore(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): MilkyWayCoreState {
  const core = galacticCentrePosition(date, latitudeDeg, longitudeDeg);
  const sun = sunPosition(date, latitudeDeg, longitudeDeg);
  const moon = moonPosition(date, latitudeDeg, longitudeDeg);
  const moonUp = moon.elevationDeg > moonHorizonThresholdDeg(moon.distanceKm);
  return milkyWayCoreFrom(core, sun.elevationDeg, moonUp, moon.illuminatedFraction);
}

/** A stretch of one night in which the core verdict stays `visible`. */
export interface MilkyWayWindow {
  /** UTC, to the minute, both inside the stretch (`milkyWayCore` is `visible` at each). */
  start: Date;
  end: Date;
  /** Highest the core stands inside the window, and when. */
  peakElevationDeg: number;
  peakAt: Date;
  /** A thin Moon (under the limit) is up for some of it. */
  withThinMoon: boolean;
}

export type MilkyWayWindowsReason =
  'none' | 'no-astronomical-night' | 'core-never-up' | 'moon' | 'too-short';

export interface MilkyWayWindows {
  windows: MilkyWayWindow[];
  /**
   * When there are none, the first thing that rules every night out, in verdict order: no
   * astronomical night at all; the core never 10° up in the dark; the Moon over every dark hour
   * the core is up; or the core shootable only in runs shorter than the minimum.
   */
  reason: MilkyWayWindowsReason;
  /** The scan's extent. */
  from: Date;
  days: number;
}

/**
 * The nights ahead on which the core can be photographed: every stretch (≥ `minMinutes`) of
 * `visible` verdicts in `days` × 24 h from `from`, with the edges found to the minute and kept
 * inside the stretch. Start the scan at local noon so no night is split by a boundary (a window
 * cut by the scan's edges is reported as far as the scan saw it). The scan takes the Sun first
 * (cheap) and asks for the Moon only inside astronomical night with the core high enough, so 45
 * nights cost a few thousand Sun positions and a few hundred Moon positions.
 */
export function milkyWayWindows(
  from: Date,
  days: number,
  latitudeDeg: number,
  longitudeDeg: number,
  opts: { stepMinutes?: number; minMinutes?: number } = {},
): MilkyWayWindows {
  const MINUTE = 60_000;
  const stepMs = (opts.stepMinutes ?? 10) * MINUTE;
  const minMs = (opts.minMinutes ?? 30) * MINUTE;
  const t0 = from.getTime();
  const t1 = t0 + days * 86_400_000;
  let anyNight = false;
  let anyCoreUp = false;
  let anyVisible = false;
  const visibleAt = (t: number): { ok: boolean; core: number; moonUp: boolean } => {
    const d = new Date(t);
    const sunEl = sunPosition(d, latitudeDeg, longitudeDeg).elevationDeg;
    if (sunEl > -18) return { ok: false, core: Number.NaN, moonUp: false };
    anyNight = true;
    const core = galacticCentrePosition(d, latitudeDeg, longitudeDeg);
    if (core.elevationDeg < MILKY_WAY_LOW_ELEVATION_DEG)
      return { ok: false, core: core.elevationDeg, moonUp: false };
    anyCoreUp = true;
    const moon = moonPosition(d, latitudeDeg, longitudeDeg);
    const moonUp = moon.elevationDeg > moonHorizonThresholdDeg(moon.distanceKm);
    const ok = !(moonUp && moon.illuminatedFraction > MILKY_WAY_MOON_LIMIT);
    if (ok) anyVisible = true;
    return { ok, core: core.elevationDeg, moonUp };
  };
  // Bisect the edge between a not-visible and a visible instant; the result is on the visible side.
  const edge = (bad: number, good: number): number => {
    let lo = bad;
    let hi = good;
    while (Math.abs(hi - lo) > MINUTE) {
      const mid = (lo + hi) / 2;
      if (visibleAt(mid).ok) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const windows: MilkyWayWindow[] = [];
  let open: { start: number; peak: number; peakAt: number; thinMoon: boolean } | null = null;
  const close = (o: NonNullable<typeof open>, endEdge: number) => {
    // Printed minutes stay inside the stretch: the start rounds up, the end rounds down.
    const start = Math.ceil(o.start / MINUTE) * MINUTE;
    const end = Math.floor(endEdge / MINUTE) * MINUTE;
    if (end - start >= minMs)
      windows.push({
        start: new Date(start),
        end: new Date(end),
        peakElevationDeg: o.peak,
        peakAt: new Date(o.peakAt),
        withThinMoon: o.thinMoon,
      });
  };
  let prev = t0;
  for (let t = t0; t <= t1; t += stepMs) {
    const v = visibleAt(t);
    if (v.ok) {
      if (!open) {
        const start = t === t0 ? t0 : edge(prev, t);
        open = { start, peak: v.core, peakAt: t, thinMoon: v.moonUp };
      } else if (v.core > open.peak) {
        open.peak = v.core;
        open.peakAt = t;
      }
      if (v.moonUp) open.thinMoon = true;
    } else if (open) {
      close(open, edge(t, prev));
      open = null;
    }
    prev = t;
  }
  if (open) close(open, prev);
  const reason: MilkyWayWindowsReason = windows.length
    ? 'none'
    : !anyNight
      ? 'no-astronomical-night'
      : !anyCoreUp
        ? 'core-never-up'
        : !anyVisible
          ? 'moon'
          : 'too-short';
  return { windows, reason, from, days };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13 Jun 20:39–04:23 (core to 40°)" in a zone; a window past midnight keeps its start date. */
export function formatMilkyWayWindow(w: MilkyWayWindow, zone: string): string {
  const s = utcToWallClock(w.start, zone);
  return `${s.day} ${MONTHS[s.month - 1] ?? ''} ${formatWallTime(w.start, zone)}–${formatWallTime(w.end, zone)} (core to ${Math.round(w.peakElevationDeg)}°)`;
}

/**
 * One line on the dark windows ahead, in a zone: "3 Jun 21:09–22:19 (core to 21°) · 4 Jun
 * 21:06–22:59 (core to 28°) · 5 Jun 21:02–23:36 (core to 33°) · 34 more in 45 nights", or why
 * there are none.
 */
export function describeMilkyWayWindows(r: MilkyWayWindows, zone: string, show = 3): string {
  const nights = `${r.days} nights`;
  if (!r.windows.length) {
    switch (r.reason) {
      case 'no-astronomical-night':
        return `No astronomical night here in the next ${nights}`;
      case 'core-never-up':
        return `The core never stands ${MILKY_WAY_LOW_ELEVATION_DEG}° up in the dark here in the next ${nights}`;
      case 'moon':
        return `The Moon lights every dark hour the core is up in the next ${nights}`;
      case 'too-short':
        return `The core clears ${MILKY_WAY_LOW_ELEVATION_DEG}° in the dark only for minutes at a time in the next ${nights}`;
      case 'none':
        return `No dark window in the next ${nights}`;
    }
  }
  const parts = r.windows.slice(0, show).map((w) => formatMilkyWayWindow(w, zone));
  const more = r.windows.length - show;
  return more > 0 ? `${parts.join(' · ')} · ${more} more in ${nights}` : parts.join(' · ');
}

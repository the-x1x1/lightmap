/**
 * Moon position and phase.
 *
 * Algorithm: the low-precision geocentric lunar formulae published in *The Astronomical Almanac*
 * (section D, "Low-precision formulae for geocentric coordinates of the Moon"), which give the
 * ecliptic longitude and latitude to about 0.3° and the horizontal parallax to about 0.003° for
 * 1950–2050. The topocentric correction for parallax (up to ~1° in altitude) is applied because
 * it matters for moonrise planning. Illuminated fraction follows Meeus ch. 48 (phase angle from
 * the Sun–Moon elongation).
 *
 * Honest accuracy statement (surfaced in the UI as the lunar confidence note): position ±0.3°,
 * illumination ±2 %, rise/set ±3 min. That is sufficient to plan where the Moon will be in a
 * frame; it is not an eclipse ephemeris. The AstronomyService interface allows a higher-precision
 * backend (e.g. the MIT-licensed astronomy-engine) to be swapped in without touching callers
 * (ADR-0006).
 */
import { solarEquatorial, toHorizontal, type HorizontalCoordinates } from './solar.ts';
import { julianCenturiesTT } from './time.ts';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const EARTH_EQUATORIAL_RADIUS_KM = 6378.14;

function wrap360(x: number): number {
  const r = x % 360;
  return r < 0 ? r + 360 : r;
}

export interface LunarEquatorial {
  rightAscensionDeg: number;
  declinationDeg: number;
  /** Ecliptic longitude/latitude, degrees. */
  eclipticLongitudeDeg: number;
  eclipticLatitudeDeg: number;
  /** Equatorial horizontal parallax, degrees. */
  parallaxDeg: number;
  distanceKm: number;
}

export function lunarEquatorial(T: number): LunarEquatorial {
  const s = (deg: number) => Math.sin(deg * DEG);
  const c = (deg: number) => Math.cos(deg * DEG);
  const lambda = wrap360(
    218.32 +
      481_267.881 * T +
      6.29 * s(135.0 + 477_198.87 * T) -
      1.27 * s(259.3 - 413_335.36 * T) +
      0.66 * s(235.7 + 890_534.22 * T) +
      0.21 * s(269.9 + 954_397.74 * T) -
      0.19 * s(357.5 + 35_999.05 * T) -
      0.11 * s(186.5 + 966_404.03 * T),
  );
  const beta =
    5.13 * s(93.3 + 483_202.02 * T) +
    0.28 * s(228.2 + 960_400.89 * T) -
    0.28 * s(318.3 + 6_003.15 * T) -
    0.17 * s(217.6 - 407_332.21 * T);
  const parallax =
    0.9508 +
    0.0518 * c(135.0 + 477_198.87 * T) +
    0.0095 * c(259.3 - 413_335.36 * T) +
    0.0078 * c(235.7 + 890_534.22 * T) +
    0.0028 * c(269.9 + 954_397.74 * T);
  const distanceKm = EARTH_EQUATORIAL_RADIUS_KM / Math.sin(parallax * DEG);

  // Ecliptic → equatorial with the mean obliquity (nutation is far below this method's accuracy).
  const eps = (23.439_291_111 - 0.013_004_167 * T) * DEG;
  const l = lambda * DEG;
  const b = beta * DEG;
  const x = Math.cos(b) * Math.cos(l);
  const y = Math.cos(eps) * Math.cos(b) * Math.sin(l) - Math.sin(eps) * Math.sin(b);
  const z = Math.sin(eps) * Math.cos(b) * Math.sin(l) + Math.cos(eps) * Math.sin(b);
  const ra = wrap360(Math.atan2(y, x) * RAD);
  const dec = Math.asin(Math.max(-1, Math.min(1, z))) * RAD;
  return {
    rightAscensionDeg: ra,
    declinationDeg: dec,
    eclipticLongitudeDeg: lambda,
    eclipticLatitudeDeg: beta,
    parallaxDeg: parallax,
    distanceKm,
  };
}

export type MoonPhaseName =
  | 'New Moon'
  | 'Waxing Crescent'
  | 'First Quarter'
  | 'Waxing Gibbous'
  | 'Full Moon'
  | 'Waning Gibbous'
  | 'Last Quarter'
  | 'Waning Crescent';

export interface MoonPosition extends HorizontalCoordinates {
  /** Topocentric (parallax-corrected) elevation, degrees. */
  topocentricElevationDeg: number;
  declinationDeg: number;
  rightAscensionDeg: number;
  distanceKm: number;
  /** Fraction of the disc illuminated, 0–1. */
  illuminatedFraction: number;
  /** Phase angle in degrees, 0 = full, 180 = new. */
  phaseAngleDeg: number;
  /** Elongation of the Moon from the Sun in ecliptic longitude, degrees [0, 360): 0 new, 90 first quarter, 180 full. */
  elongationDeg: number;
  /** Synodic age in days since new moon (0 – 29.53). */
  ageDays: number;
  phaseName: MoonPhaseName;
  /** Whether the Moon is waxing (elongation < 180). */
  waxing: boolean;
}

export const SYNODIC_MONTH_DAYS = 29.530_588_853;

/**
 * Phase name convention (matches the US Naval Observatory's `curphase`): a principal phase — New,
 * First Quarter, Full, Last Quarter — is named from its instant until roughly a day later
 * (12° of elongation); before the instant the Moon is still the preceding crescent/gibbous. So
 * on a day whose First Quarter falls at 14:55, the morning reads "Waxing Crescent" and the
 * evening "First Quarter", which is literally true and is what almanacs print.
 */
export function moonPhaseName(elongationDeg: number): MoonPhaseName {
  const e = wrap360(elongationDeg);
  const w = 12.2; // ≈ 24 h of mean elongation change
  if (e < w) return 'New Moon';
  if (e < 90) return 'Waxing Crescent';
  if (e < 90 + w) return 'First Quarter';
  if (e < 180) return 'Waxing Gibbous';
  if (e < 180 + w) return 'Full Moon';
  if (e < 270) return 'Waning Gibbous';
  if (e < 270 + w) return 'Last Quarter';
  return 'Waning Crescent';
}

export function moonPosition(date: Date, latitudeDeg: number, longitudeDeg: number): MoonPosition {
  const T = julianCenturiesTT(date);
  const moon = lunarEquatorial(T);
  const sun = solarEquatorial(T);
  const hz = toHorizontal(moon, date, latitudeDeg, longitudeDeg);
  // Topocentric altitude: h' = h − π cos h (adequate at this method's accuracy).
  const topo = hz.elevationDeg - moon.parallaxDeg * Math.cos(hz.elevationDeg * DEG);

  // Phase (Meeus 48.2 via geocentric elongation).
  const elongation = wrap360(moon.eclipticLongitudeDeg - sun.eclipticLongitudeDeg);
  const psi = Math.acos(Math.cos(moon.eclipticLatitudeDeg * DEG) * Math.cos(elongation * DEG)); // geocentric elongation
  const sunDistKm = sun.distanceAu * 149_597_870.7;
  const phaseAngle = Math.atan2(
    sunDistKm * Math.sin(psi),
    moon.distanceKm - sunDistKm * Math.cos(psi),
  );
  const k = (1 + Math.cos(phaseAngle)) / 2;

  return {
    ...hz,
    topocentricElevationDeg: topo,
    declinationDeg: moon.declinationDeg,
    rightAscensionDeg: moon.rightAscensionDeg,
    distanceKm: moon.distanceKm,
    illuminatedFraction: k,
    phaseAngleDeg: phaseAngle * RAD,
    elongationDeg: elongation,
    ageDays: (elongation / 360) * SYNODIC_MONTH_DAYS,
    phaseName: moonPhaseName(elongation),
    waxing: elongation < 180,
  };
}

/** Moonrise / moonset within [start, end) using the topocentric upper-limb threshold (+0.125° ≈ refraction − semidiameter − parallax handled above). */
export function moonRiseSet(
  start: Date,
  end: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): { moonrise: Date | null; moonset: Date | null; alwaysUp: boolean; alwaysDown: boolean } {
  const threshold = 0.125; // Meeus 15.1: h0 = 0.7275π − 0°34′, ≈ +0.125° for topocentric altitude after our parallax step
  const step = 10 * 60_000;
  const f = (t: number) =>
    moonPosition(new Date(t), latitudeDeg, longitudeDeg).topocentricElevationDeg - threshold;
  let moonrise: Date | null = null;
  let moonset: Date | null = null;
  let anyUp = false;
  let anyDown = false;
  let prevT = start.getTime();
  let prev = f(prevT);
  if (prev >= 0) anyUp = true;
  else anyDown = true;
  for (let t = prevT + step; t <= end.getTime(); t += step) {
    const cur = f(t);
    if (cur >= 0) anyUp = true;
    else anyDown = true;
    if (prev < 0 && cur >= 0 && moonrise === null) moonrise = new Date(bisect(f, prevT, t));
    if (prev >= 0 && cur < 0 && moonset === null) moonset = new Date(bisect(f, prevT, t));
    prevT = t;
    prev = cur;
  }
  return { moonrise, moonset, alwaysUp: anyUp && !anyDown, alwaysDown: anyDown && !anyUp };
}

function bisect(f: (t: number) => number, a: number, b: number): number {
  let fa = f(a);
  for (let i = 0; i < 40 && b - a > 1000; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fa < 0 === fm < 0) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return Math.round((a + b) / 2 / 1000) * 1000;
}

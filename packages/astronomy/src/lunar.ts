/**
 * Moon position and phase.
 *
 * Algorithm: Meeus, *Astronomical Algorithms* ch. 47 — the abbreviated ELP-2000/82 series (60
 * terms in longitude and distance, 60 in latitude, plus the planetary and flattening terms),
 * nutation from the short form of ch. 22, true obliquity; validated against Meeus's worked
 * example 47.a to the last digit of the published sums. Geocentric accuracy ≈ 10″ in longitude,
 * 4″ in latitude. Parallax (up to ~1°) is applied exactly through the topocentric equatorial
 * correction of ch. 40 rather than the first-order h′ = h − π·cos h, which left a second-order
 * altitude error of up to 0.01° — half the stated budget. (On the ellipsoid the azimuth change is
 * only ≈ π·sin(φ − φ′) ≈ 0.003°; the correction matters for altitude.) Illuminated fraction follows Meeus ch. 48 (phase angle from the Sun–Moon
 * elongation).
 *
 * Honest accuracy statement (surfaced in the UI as the lunar confidence note): position ±0.02°,
 * illumination ±1 %, rise/set ±1 min. That is ample to plan where the Moon will be in a frame; it
 * is not an eclipse ephemeris. The AstronomyService interface allows a higher-precision backend
 * (e.g. the MIT-licensed astronomy-engine) to be swapped in without touching callers (ADR-0006).
 */
import {
  apparentSiderealTimeDeg,
  meanObliquityDeg,
  nutationDeg,
  solarEquatorial,
  toHorizontal,
  type HorizontalCoordinates,
} from './solar.ts';
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

/*
 * Meeus, Astronomical Algorithms ch. 47 (abbreviated ELP-2000/82): 60 periodic terms each for
 * longitude/distance (Table 47.A) and latitude (Table 47.B). Rows are [D, M, M', F, Σl, Σr] and
 * [D, M, M', F, Σb]; coefficients are in 1e-6 degrees (Σl, Σb) and 1e-3 km (Σr).
 */
const LR_TERMS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],
  [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],
  [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],
  [2, 0, -1, -2, 0, 8752],
];

const B_TERMS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777],
  [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596],
  [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439],
  [2, 0, 2, 1, 422],
  [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351],
  [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315],
  [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229],
  [1, 1, 0, -1, 223],
  [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220],
  [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177],
  [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119],
  [4, -1, 0, -1, 115],
  [2, -2, 0, 1, 107],
];

/** The Moon's fundamental arguments at T (Meeus 47.1–47.5, 47.6–47.9), degrees, and E (47.6). */
export function lunarArguments(T: number): {
  Lp: number;
  D: number;
  M: number;
  Mp: number;
  F: number;
  A1: number;
  A2: number;
  A3: number;
  E: number;
} {
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  return {
    Lp: wrap360(
      218.316_447_7 + 481_267.881_234_21 * T - 0.001_578_6 * T2 + T3 / 538_841 - T4 / 65_194_000,
    ),
    D: wrap360(
      297.850_192_1 + 445_267.111_403_4 * T - 0.001_881_9 * T2 + T3 / 545_868 - T4 / 113_065_000,
    ),
    M: wrap360(357.529_109_2 + 35_999.050_290_9 * T - 0.000_153_6 * T2 + T3 / 24_490_000),
    Mp: wrap360(
      134.963_396_4 + 477_198.867_505_5 * T + 0.008_741_4 * T2 + T3 / 69_699 - T4 / 14_712_000,
    ),
    F: wrap360(
      93.272_095 + 483_202.017_523_3 * T - 0.003_653_9 * T2 - T3 / 3_526_000 + T4 / 863_310_000,
    ),
    A1: wrap360(119.75 + 131.849 * T),
    A2: wrap360(53.09 + 479_264.29 * T),
    A3: wrap360(313.45 + 481_266.484 * T),
    E: 1 - 0.002_516 * T - 0.000_007_4 * T2,
  };
}

/** The periodic sums Σl, Σb (1e-6 °) and Σr (1e-3 km) of Meeus ch. 47, exposed for the worked-example test. */
export function lunarPeriodicSums(T: number): { sumL: number; sumB: number; sumR: number } {
  const a = lunarArguments(T);
  const s = (deg: number) => Math.sin(deg * DEG);
  const c = (deg: number) => Math.cos(deg * DEG);
  let sumL = 0;
  let sumR = 0;
  for (const [d, m, mp, f, l, r] of LR_TERMS) {
    const arg = d * a.D + m * a.M + mp * a.Mp + f * a.F;
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? a.E : a.E * a.E;
    sumL += l * e * s(arg);
    sumR += r * e * c(arg);
  }
  let sumB = 0;
  for (const [d, m, mp, f, b] of B_TERMS) {
    const arg = d * a.D + m * a.M + mp * a.Mp + f * a.F;
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? a.E : a.E * a.E;
    sumB += b * e * s(arg);
  }
  // Additive terms: Venus (A1), Jupiter (A2), flattening of the Earth (A3, L'−F).
  sumL += 3958 * s(a.A1) + 1962 * s(a.Lp - a.F) + 318 * s(a.A2);
  sumB +=
    -2235 * s(a.Lp) +
    382 * s(a.A3) +
    175 * s(a.A1 - a.F) +
    175 * s(a.A1 + a.F) +
    127 * s(a.Lp - a.Mp) -
    115 * s(a.Lp + a.Mp);
  return { sumL, sumB, sumR };
}

/**
 * Geocentric apparent equatorial coordinates of the Moon at Julian centuries T (TT): ecliptic
 * longitude/latitude from the abbreviated ELP-2000/82 series (Meeus ch. 47; ≈ 10″ in longitude,
 * 4″ in latitude), nutation applied, true obliquity.
 */
export function lunarEquatorial(T: number): LunarEquatorial {
  const a = lunarArguments(T);
  const sums = lunarPeriodicSums(T);
  const nut = nutationDeg(T);
  const lambda = wrap360(a.Lp + sums.sumL / 1e6 + nut.dPsi);
  const beta = sums.sumB / 1e6;
  const distanceKm = 385_000.56 + sums.sumR / 1000;
  const parallax = Math.asin(EARTH_EQUATORIAL_RADIUS_KM / distanceKm) * RAD;

  const eps = (meanObliquityDeg(T) + nut.dEps) * DEG;
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
  /** Same as `elevationDeg` (both topocentric since the Meeus ch. 40 correction); kept for callers. */
  topocentricElevationDeg: number;
  /** Geocentric apparent declination / right ascension (the horizontal values are topocentric). */
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

/**
 * Geocentric → topocentric equatorial coordinates (Meeus ch. 40): the Moon's parallax moves it
 * by up to ~1° along the vertical, so the observer's position on the ellipsoid (sea level; the
 * site's height matters < 0.0015° below 6 km) is applied before going to horizontal.
 */
export function topocentricEquatorial(
  eq: { rightAscensionDeg: number; declinationDeg: number; parallaxDeg: number },
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): { rightAscensionDeg: number; declinationDeg: number } {
  const u = Math.atan(0.996_647_19 * Math.tan(latitudeDeg * DEG));
  const rhoSinPhi = 0.996_647_19 * Math.sin(u);
  const rhoCosPhi = Math.cos(u);
  const sinPi = Math.sin(eq.parallaxDeg * DEG);
  const H = (apparentSiderealTimeDeg(date) + longitudeDeg - eq.rightAscensionDeg) * DEG;
  const dec = eq.declinationDeg * DEG;
  const dAlpha = Math.atan2(
    -rhoCosPhi * sinPi * Math.sin(H),
    Math.cos(dec) - rhoCosPhi * sinPi * Math.cos(H),
  );
  const decTopo = Math.atan2(
    (Math.sin(dec) - rhoSinPhi * sinPi) * Math.cos(dAlpha),
    Math.cos(dec) - rhoCosPhi * sinPi * Math.cos(H),
  );
  return {
    rightAscensionDeg: wrap360(eq.rightAscensionDeg + dAlpha * RAD),
    declinationDeg: decTopo * RAD,
  };
}

export function moonPosition(date: Date, latitudeDeg: number, longitudeDeg: number): MoonPosition {
  const T = julianCenturiesTT(date);
  const moon = lunarEquatorial(T);
  const sun = solarEquatorial(T);
  // Azimuth and elevation are topocentric (Meeus ch. 40), so `elevationDeg` is the altitude an
  // observer sees before refraction; the geocentric altitude is not exposed.
  const hz = toHorizontal(
    topocentricEquatorial(moon, date, latitudeDeg, longitudeDeg),
    date,
    latitudeDeg,
    longitudeDeg,
  );
  const topo = hz.elevationDeg;

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

/**
 * Topocentric altitude of the Moon's centre at which its upper limb touches the apparent horizon:
 * −(semidiameter + 34′ refraction), with the semidiameter 0.2725 × the horizontal parallax.
 */
export function moonHorizonThresholdDeg(distanceKm: number): number {
  const parallaxDeg = Math.asin(EARTH_EQUATORIAL_RADIUS_KM / distanceKm) * RAD;
  return -(0.2725 * parallaxDeg + 34 / 60);
}

/**
 * Moonrise / moonset within [start, end): the instants the Moon's upper limb touches the apparent
 * horizon. Meeus 15.1 gives the *geocentric* threshold h0 = 0.7275π − 0°34′ (parallax,
 * semidiameter and refraction folded together); `moonPosition` already applies parallax, so for
 * its topocentric altitude the threshold is −(0.2725π + 0°34′) ≈ −0.83°, the semidiameter plus
 * horizon refraction.
 */
export function moonRiseSet(
  start: Date,
  end: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): { moonrise: Date | null; moonset: Date | null; alwaysUp: boolean; alwaysDown: boolean } {
  const step = 5 * 60_000; // a grazing rise+set pair at high latitude fits inside 10 minutes
  const f = (t: number) => {
    const m = moonPosition(new Date(t), latitudeDeg, longitudeDeg);
    return m.topocentricElevationDeg - moonHorizonThresholdDeg(m.distanceKm);
  };
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

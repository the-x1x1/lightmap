/**
 * Solar position.
 *
 * Algorithm: Jean Meeus, *Astronomical Algorithms* (2nd ed.), chapter 25 ("Solar Coordinates",
 * low-accuracy method, ≈ 0.01° in longitude) with the nutation/aberration correction for the
 * apparent longitude, chapter 22 for the mean obliquity, chapter 12 for Greenwich mean sidereal
 * time and chapter 13 for the equatorial → horizontal transformation. This is the same family of
 * formulae NOAA publishes for its Solar Calculator.
 *
 * Accuracy: geocentric apparent position within ~0.01° of the USNO ephemeris for 1950–2050
 * (validated in tests/golden.test.ts against aa.usno.navy.mil). Topocentric parallax of the Sun
 * (< 0.0025°) is ignored. Refraction is NOT applied to the reported elevation; a separate helper
 * gives the apparent elevation for horizon-grazing display.
 *
 * Nothing here was copied from a website or a library: the equations are transcribed from the
 * book, and every constant is a published one.
 */
import { julianCenturiesTT, julianCenturiesUT, julianDay } from './time.ts';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface EquatorialCoordinates {
  /** Right ascension, degrees [0, 360). */
  rightAscensionDeg: number;
  /** Declination, degrees. */
  declinationDeg: number;
  /** Distance from Earth in astronomical units. */
  distanceAu: number;
  /** Apparent ecliptic longitude, degrees. */
  eclipticLongitudeDeg: number;
  /** Equation of time, minutes (apparent − mean solar time). */
  equationOfTimeMinutes: number;
  /** True obliquity used, degrees. */
  obliquityDeg: number;
}

function wrap360(x: number): number {
  const r = x % 360;
  return r < 0 ? r + 360 : r;
}

/** Mean obliquity of the ecliptic (Meeus 22.2), degrees. */
export function meanObliquityDeg(T: number): number {
  return 23.439_291_111 - 0.013_004_167 * T - 1.638_89e-7 * T * T + 5.036_11e-7 * T * T * T;
}

/** Geocentric apparent equatorial coordinates of the Sun at Julian centuries T (TT). */
export function solarEquatorial(T: number): EquatorialCoordinates {
  const L0 = wrap360(280.466_46 + 36_000.769_83 * T + 0.000_303_2 * T * T); // mean longitude
  const M = wrap360(357.529_11 + 35_999.050_29 * T - 0.000_153_7 * T * T); // mean anomaly
  const e = 0.016_708_634 - 0.000_042_037 * T - 0.000_000_126_7 * T * T; // eccentricity
  const Mr = M * DEG;
  const C =
    (1.914_602 - 0.004_817 * T - 0.000_014 * T * T) * Math.sin(Mr) +
    (0.019_993 - 0.000_101 * T) * Math.sin(2 * Mr) +
    0.000_289 * Math.sin(3 * Mr); // equation of centre
  const trueLongitude = L0 + C;
  const trueAnomaly = M + C;
  const R = (1.000_001_018 * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly * DEG));
  const omega = 125.04 - 1934.136 * T; // longitude of the ascending node of the Moon's mean orbit
  const apparentLongitude = trueLongitude - 0.005_69 - 0.004_78 * Math.sin(omega * DEG);
  const epsilon0 = meanObliquityDeg(T);
  const epsilon = epsilon0 + 0.002_56 * Math.cos(omega * DEG); // corrected for nutation (apparent)
  const lam = apparentLongitude * DEG;
  const eps = epsilon * DEG;
  const ra = wrap360(Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * RAD);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)) * RAD;

  // Equation of time (Meeus 28.3), radians → minutes.
  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * DEG;
  const E =
    y * Math.sin(2 * L0r) -
    2 * e * Math.sin(Mr) +
    4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
    0.5 * y * y * Math.sin(4 * L0r) -
    1.25 * e * e * Math.sin(2 * Mr);
  const eot = E * RAD * 4;

  return {
    rightAscensionDeg: ra,
    declinationDeg: dec,
    distanceAu: R,
    eclipticLongitudeDeg: wrap360(apparentLongitude),
    equationOfTimeMinutes: eot,
    obliquityDeg: epsilon,
  };
}

/** Greenwich mean sidereal time in degrees (Meeus 12.4). */
export function greenwichMeanSiderealTimeDeg(date: Date): number {
  const jd = julianDay(date);
  const T = julianCenturiesUT(date);
  return wrap360(280.460_618_37 + 360.985_647_366_29 * (jd - 2_451_545.0) + 0.000_387_933 * T * T - (T * T * T) / 38_710_000);
}

export interface HorizontalCoordinates {
  /** Degrees clockwise from true north, [0, 360). */
  azimuthDeg: number;
  /** Geometric elevation above the horizon, degrees. */
  elevationDeg: number;
  /** Local hour angle, degrees in [-180, 180). Negative before local transit. */
  hourAngleDeg: number;
}

/** Equatorial → horizontal for an observer (Meeus ch. 13). Azimuth from north. */
export function toHorizontal(eq: Pick<EquatorialCoordinates, 'rightAscensionDeg' | 'declinationDeg'>, date: Date, latitudeDeg: number, longitudeDeg: number): HorizontalCoordinates {
  const gmst = greenwichMeanSiderealTimeDeg(date);
  let H = wrap360(gmst + longitudeDeg - eq.rightAscensionDeg);
  if (H >= 180) H -= 360;
  const Hr = H * DEG;
  const phi = latitudeDeg * DEG;
  const dec = eq.declinationDeg * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(Hr);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD;
  // Meeus measures azimuth from south; add 180° for the compass convention.
  const azSouth = Math.atan2(Math.sin(Hr), Math.cos(Hr) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * RAD;
  return { azimuthDeg: wrap360(azSouth + 180), elevationDeg: elevation, hourAngleDeg: H };
}

export interface SunPosition extends HorizontalCoordinates {
  declinationDeg: number;
  rightAscensionDeg: number;
  distanceAu: number;
  equationOfTimeMinutes: number;
  /** Apparent elevation including atmospheric refraction, degrees. */
  apparentElevationDeg: number;
}

export function sunPosition(date: Date, latitudeDeg: number, longitudeDeg: number): SunPosition {
  const eq = solarEquatorial(julianCenturiesTT(date));
  const hz = toHorizontal(eq, date, latitudeDeg, longitudeDeg);
  return {
    ...hz,
    declinationDeg: eq.declinationDeg,
    rightAscensionDeg: eq.rightAscensionDeg,
    distanceAu: eq.distanceAu,
    equationOfTimeMinutes: eq.equationOfTimeMinutes,
    apparentElevationDeg: hz.elevationDeg + refractionDeg(hz.elevationDeg),
  };
}

/**
 * Atmospheric refraction for a geometric elevation (Sæmundsson's formula as given in Meeus 16.4),
 * degrees, for standard pressure and 10 °C. Zero below −2°, where the formula stops being meaningful.
 */
export function refractionDeg(elevationDeg: number): number {
  if (elevationDeg < -2) return 0;
  const h = Math.max(elevationDeg, -1.9);
  const r = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG); // arcminutes
  return r / 60;
}

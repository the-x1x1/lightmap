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
import { julianCenturiesTT } from './time.ts';

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

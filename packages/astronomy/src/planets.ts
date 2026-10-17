/**
 * The five naked-eye planets for an observer: where they stand and how bright they are. Venus
 * and Jupiter are often the brightest points of a twilight sky, and a photographer framing a
 * dusk or a conjunction plans around them; the star field the 3D preview draws has none.
 *
 * Positions from JPL's "Keplerian Elements for Approximate Positions of the Major Planets"
 * (E M Standish; Table 1, valid 1800-2050; heliocentric errors of 15-40" for Mercury to Mars and
 * about 400-600" for Jupiter and Saturn), referred to the mean ecliptic and equinox of J2000,
 * with the light time taken out once and precessed to the date (`precessFromJ2000`). The Earth
 * is taken at the Earth-Moon barycentre (at most 4,700 km off: 20" at Venus's closest). Good to
 * about 0.05 deg for Mercury to Mars and 0.2 deg for Jupiter and Saturn: plenty for where a
 * planet stands in a frame, not for an occultation.
 *
 * Brightness from the Astronomical Almanac's formulas (as given in Meeus, "Astronomical
 * Algorithms", ch. 41), Saturn's with its rings' tilt toward the Earth (the pole of Davies et
 * al. 1996).
 */
import { julianCenturiesTT } from './time.ts';
import { toHorizontal } from './solar.ts';
import { precessFromJ2000 } from './night-sky.ts';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export type PlanetName = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn';

/** The planets in the order they are drawn and listed. */
export const PLANETS: readonly PlanetName[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];

/** a (au), e, I, L, long. perihelion, long. node (deg) at J2000 and their rates per century. */
type Elements = readonly [number, number, number, number, number, number];

const ELEMENTS: Record<PlanetName | 'earth', { at: Elements; rate: Elements }> = {
  mercury: {
    at: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  },
  venus: {
    at: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    rate: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  },
  // The Earth-Moon barycentre.
  earth: {
    at: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  },
  mars: {
    at: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  },
  jupiter: {
    at: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  saturn: {
    at: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
};

interface Vec {
  x: number;
  y: number;
  z: number;
}

/** Heliocentric position in the J2000 ecliptic frame, au, at T Julian centuries (TT). */
export function heliocentricEcliptic(body: PlanetName | 'earth', T: number): Vec {
  const { at, rate } = ELEMENTS[body];
  const [a, e, I, L, peri, node] = at.map((v, i) => v + (rate[i] ?? 0) * T) as unknown as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const omega = (peri - node) * DEG;
  let M = ((((L - peri) % 360) + 540) % 360) - 180;
  M *= DEG;
  // Kepler's equation by Newton's method, from M + e sin M.
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cO = Math.cos(node * DEG);
  const sO = Math.sin(node * DEG);
  const cI = Math.cos(I * DEG);
  const sI = Math.sin(I * DEG);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
  };
}

/** The obliquity JPL's elements are rotated to the equator with. */
const J2000_OBLIQUITY_DEG = 23.43928;
/** Light's time over one au, in Julian centuries. */
const LIGHT_AU_CENTURIES = 0.005_775_518_3 / 36525;

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: Vec) => Math.hypot(v.x, v.y, v.z);
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;

function eclipticToEquatorial(v: Vec): Vec {
  const e = J2000_OBLIQUITY_DEG * DEG;
  return {
    x: v.x,
    y: Math.cos(e) * v.y - Math.sin(e) * v.z,
    z: Math.sin(e) * v.y + Math.cos(e) * v.z,
  };
}

/** Saturn's north pole, J2000 equatorial (Davies et al. 1996). */
const SATURN_POLE = (() => {
  const ra = 40.589 * DEG;
  const dec = 83.537 * DEG;
  return { x: Math.cos(dec) * Math.cos(ra), y: Math.cos(dec) * Math.sin(ra), z: Math.sin(dec) };
})();

/**
 * Visual magnitude (the Astronomical Almanac's formulas, Meeus ch. 41) from the distances to the
 * Sun and the Earth (au) and the phase angle (deg); Saturn's from its rings' tilt as well (the
 * phase angle stands in for the Sun-Earth difference in Saturnicentric longitude, within ~0.2 mag).
 */
export function planetMagnitude(
  name: PlanetName,
  r: number,
  delta: number,
  phaseDeg: number,
  ringTiltDeg = 0,
): number {
  const d = 5 * Math.log10(r * delta);
  const i = phaseDeg;
  switch (name) {
    case 'mercury':
      return -0.42 + d + 0.038 * i - 0.000273 * i * i + 0.000002 * i * i * i;
    case 'venus':
      return -4.4 + d + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i * i * i;
    case 'mars':
      return -1.52 + d + 0.016 * i;
    case 'jupiter':
      return -9.4 + d + 0.005 * i;
    case 'saturn': {
      const sB = Math.sin(Math.abs(ringTiltDeg) * DEG);
      return -8.88 + d + 0.044 * i - 2.6 * sB + 1.25 * sB * sB;
    }
  }
}

export interface PlanetPosition {
  name: PlanetName;
  /** Azimuth from north and geometric elevation for the observer, degrees. */
  azimuthDeg: number;
  elevationDeg: number;
  /** Equatorial place of date, degrees. */
  rightAscensionDeg: number;
  declinationDeg: number;
  /** Distance from the Earth, au. */
  distanceAu: number;
  /** Visual magnitude (smaller is brighter: Venus about -4, Saturn about +1). */
  magnitude: number;
  /** Angle Sun-planet-Earth, degrees (0 full). */
  phaseAngleDeg: number;
  /** Angular distance from the Sun as seen from the Earth, degrees. */
  elongationDeg: number;
}

/** A planet's equatorial place of date and brightness at T (geocentric). */
export function planetGeocentric(
  name: PlanetName,
  T: number,
): Omit<PlanetPosition, 'name' | 'azimuthDeg' | 'elevationDeg'> {
  const earth = heliocentricEcliptic('earth', T);
  // The light that arrives now left the planet a light time ago.
  let helio = heliocentricEcliptic(name, T);
  let geo = sub(helio, earth);
  helio = heliocentricEcliptic(name, T - len(geo) * LIGHT_AU_CENTURIES);
  geo = sub(helio, earth);
  const delta = len(geo);
  const r = len(helio);
  const phase = Math.acos(Math.max(-1, Math.min(1, dot(helio, geo) / (r * delta)))) * RAD;
  const toSun = { x: -earth.x, y: -earth.y, z: -earth.z };
  const elong = Math.acos(Math.max(-1, Math.min(1, dot(geo, toSun) / (delta * len(toSun))))) * RAD;
  const eq = eclipticToEquatorial(geo);
  let ringTilt = 0;
  if (name === 'saturn') {
    // The rings' tilt toward the Earth: the Earth's direction from Saturn against its pole.
    const fromSaturn = { x: -eq.x / delta, y: -eq.y / delta, z: -eq.z / delta };
    ringTilt = Math.asin(Math.max(-1, Math.min(1, dot(fromSaturn, SATURN_POLE)))) * RAD;
  }
  const ra = (Math.atan2(eq.y, eq.x) * RAD + 360) % 360;
  const dec = Math.asin(Math.max(-1, Math.min(1, eq.z / delta))) * RAD;
  const ofDate = precessFromJ2000(ra, dec, T);
  return {
    rightAscensionDeg: ofDate.rightAscensionDeg,
    declinationDeg: ofDate.declinationDeg,
    distanceAu: delta,
    magnitude: planetMagnitude(name, r, delta, phase, ringTilt),
    phaseAngleDeg: phase,
    elongationDeg: elong,
  };
}

/** Where the five naked-eye planets stand for an observer, and how bright they are. */
export function planetPositions(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): PlanetPosition[] {
  const T = julianCenturiesTT(date);
  return PLANETS.map((name) => {
    const g = planetGeocentric(name, T);
    const hz = toHorizontal(g, date, latitudeDeg, longitudeDeg);
    return { name, azimuthDeg: hz.azimuthDeg, elevationDeg: hz.elevationDeg, ...g };
  });
}

/** Angular distance between two equatorial places, degrees. */
export function angularSeparationDeg(
  a: { rightAscensionDeg: number; declinationDeg: number },
  b: { rightAscensionDeg: number; declinationDeg: number },
): number {
  const d1 = a.declinationDeg * DEG;
  const d2 = b.declinationDeg * DEG;
  const dra = (a.rightAscensionDeg - b.rightAscensionDeg) * DEG;
  const c = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dra);
  return Math.acos(Math.max(-1, Math.min(1, c))) * RAD;
}

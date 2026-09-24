/**
 * Terrain horizon (roadmap Phase 6/8; plan §26 "sun setting behind a ridge"): the elevation angle
 * of the land horizon around a viewpoint, from terrain heights sampled along rays, and the
 * consequences for the Sun — is it behind the ridge right now, and when does it clear or drop
 * behind the terrain today.
 *
 * Pure: the sampling is the renderer's job (`SceneHost.sampleGroundHeights`); this module turns
 * samples into a profile and answers questions about it. Earth curvature and standard
 * atmospheric refraction (k = 0.13) are included through an effective radius; the Sun's apparent
 * position uses the same refraction model as sunrise/sunset. What is *not* included is stated in
 * `HorizonProfile.caveat` and must be shown wherever the profile is used: vegetation and
 * buildings are not in a DEM, and the DEM's resolution limits sharp ridgelines.
 */
import { EARTH_RADIUS_M, destinationPoint, type GeoPoint } from '@lightmap/geospatial';
import { refractionDeg } from '@lightmap/astronomy';

const DEG = Math.PI / 180;
/** Standard refraction coefficient for terrestrial lines of sight. */
const REFRACTION_K = 0.13;
const EFFECTIVE_RADIUS_M = EARTH_RADIUS_M / (1 - REFRACTION_K);
/** Solar semi-diameter: the upper limb shows before the centre clears the ridge. */
const SUN_SEMIDIAMETER_DEG = 0.27;

export interface HorizonSamplePoint {
  azimuthDeg: number;
  distanceM: number;
  point: GeoPoint;
}

export interface HorizonSample {
  azimuthDeg: number;
  distanceM: number;
  /** Terrain height above the ellipsoid/MSL at the point, metres; null when unknown. */
  heightM: number | null;
}

export interface HorizonProfile {
  /** Azimuths are 0, step, 2·step, … < 360 (index = azimuth / step). */
  stepDeg: number;
  /** Elevation angle of the terrain horizon per azimuth, degrees (≥ the sea-level dip). */
  elevationDeg: number[];
  /** Distance to the limiting terrain per azimuth, metres; null when nothing rises above the dip. */
  distanceM: Array<number | null>;
  origin: GeoPoint;
  /** Ground height at the origin, metres. */
  originGroundM: number;
  eyeHeightM: number;
  maxDistanceM: number;
  /** Fraction of requested samples that returned a height (1 = complete). */
  coverage: number;
  /** Highest terrain-horizon elevation in the profile, degrees. */
  maxElevationDeg: number;
  source: { providerId: string; resolutionM: number | null };
  caveat: string;
}

export const HORIZON_CAVEAT =
  'Terrain only: trees, buildings and cloud on the ridge are not in the elevation model, and a sharp ridgeline can sit between samples.';

/** Log-spaced ring distances, 40 m … 40 km (closer rings are denser: near ground blocks more sky). */
export function horizonRingDistances(maxDistanceM = 40_000, rings = 22): number[] {
  const min = 40;
  const out: number[] = [];
  for (let i = 0; i < rings; i++) {
    const f = i / (rings - 1);
    out.push(Math.round(min * Math.pow(maxDistanceM / min, f)));
  }
  return out;
}

/** Points to sample for a profile: every `stepDeg` of azimuth × every ring distance. */
export function horizonSamplePoints(
  origin: GeoPoint,
  opts: { stepDeg?: number; maxDistanceM?: number; rings?: number } = {},
): HorizonSamplePoint[] {
  const step = opts.stepDeg ?? 3;
  const distances = horizonRingDistances(opts.maxDistanceM ?? 40_000, opts.rings ?? 22);
  const out: HorizonSamplePoint[] = [];
  for (let az = 0; az < 360; az += step)
    for (const d of distances)
      out.push({ azimuthDeg: az, distanceM: d, point: destinationPoint(origin, az, d) });
  return out;
}

/** Elevation angle (degrees) of the sea-level horizon seen from `eyeAboveSeaM` (negative: the dip). */
export function seaHorizonDipDeg(eyeAboveSeaM: number): number {
  if (eyeAboveSeaM <= 0) return 0;
  return -Math.sqrt((2 * eyeAboveSeaM) / EFFECTIVE_RADIUS_M) / DEG;
}

/**
 * Elevation angle of a terrain point at `distanceM` and `heightM` seen from the eye, including
 * Earth curvature and standard refraction (the point "drops" by d² / 2R′ below the tangent plane).
 */
export function elevationAngleDeg(
  distanceM: number,
  heightM: number,
  eyeAboveSeaM: number,
): number {
  const drop = (distanceM * distanceM) / (2 * EFFECTIVE_RADIUS_M);
  return Math.atan2(heightM - eyeAboveSeaM - drop, distanceM) / DEG;
}

export function horizonProfileFromSamples(
  origin: GeoPoint,
  originGroundM: number,
  eyeHeightM: number,
  samples: readonly HorizonSample[],
  source: HorizonProfile['source'],
  opts: { stepDeg?: number; maxDistanceM?: number } = {},
): HorizonProfile {
  const step = opts.stepDeg ?? 3;
  const n = Math.round(360 / step);
  const eyeAbs = originGroundM + eyeHeightM;
  const dip = seaHorizonDipDeg(Math.max(0, eyeAbs));
  const elevationDeg = new Array<number>(n).fill(dip);
  const distanceM = new Array<number | null>(n).fill(null);
  let got = 0;
  let maxDist = opts.maxDistanceM ?? 0;
  for (const s of samples) {
    if (s.heightM === null || !Number.isFinite(s.heightM)) continue;
    got++;
    maxDist = Math.max(maxDist, s.distanceM);
    const i = Math.round(s.azimuthDeg / step) % n;
    const e = elevationAngleDeg(s.distanceM, s.heightM, eyeAbs);
    if (e > elevationDeg[i]!) {
      elevationDeg[i] = e;
      distanceM[i] = s.distanceM;
    }
  }
  return {
    stepDeg: step,
    elevationDeg,
    distanceM,
    origin,
    originGroundM,
    eyeHeightM,
    maxDistanceM: maxDist,
    coverage: samples.length ? got / samples.length : 0,
    maxElevationDeg: Math.max(...elevationDeg),
    source,
    caveat: HORIZON_CAVEAT,
  };
}

/** Terrain-horizon elevation at any azimuth (linear interpolation, wrapping at 360°). */
export function horizonElevationAt(profile: HorizonProfile, azimuthDeg: number): number {
  const n = profile.elevationDeg.length;
  if (n === 0) return 0;
  const a = (((azimuthDeg % 360) + 360) % 360) / profile.stepDeg;
  const i0 = Math.floor(a) % n;
  const i1 = (i0 + 1) % n;
  const f = a - Math.floor(a);
  return profile.elevationDeg[i0]! * (1 - f) + profile.elevationDeg[i1]! * f;
}

/**
 * Whether a body at (azimuth, geometric elevation) shows above the terrain: its apparent upper
 * limb must clear the terrain-horizon elevation at that bearing.
 */
export function aboveTerrain(
  profile: HorizonProfile,
  azimuthDeg: number,
  elevationDeg: number,
): boolean {
  const apparent = elevationDeg + refractionDeg(elevationDeg) + SUN_SEMIDIAMETER_DEG;
  return apparent >= horizonElevationAt(profile, azimuthDeg);
}

export interface TerrainSunEvents {
  /** Intervals (UTC) during which the Sun is above the terrain horizon within [dayStart, dayEnd). */
  visible: Array<{ from: Date; to: Date }>;
  /** First and last instant the Sun shows above the terrain today; null when it never does. */
  firstLight: Date | null;
  lastLight: Date | null;
  /**
   * True when the terrain changed the day's first/last light by more than three minutes (below
   * that, refraction conventions differ by as much) or split the day into several visible spells.
   */
  differsFromAstronomical: boolean;
}

/**
 * Scan the civil day for the Sun crossing the terrain horizon (5-minute samples, bisection to
 * ~10 s). `positionAt` supplies geometric azimuth/elevation; `astronomical` are the flat-horizon
 * sunrise/sunset used to say whether the terrain made a difference.
 */
export function terrainSunEvents(
  profile: HorizonProfile,
  positionAt: (t: Date) => { azimuthDeg: number; elevationDeg: number },
  day: { dayStart: Date; dayEnd: Date; sunrise: Date | null; sunset: Date | null },
  stepMinutes = 5,
): TerrainSunEvents {
  const vis = (ms: number) => {
    const p = positionAt(new Date(ms));
    return aboveTerrain(profile, p.azimuthDeg, p.elevationDeg);
  };
  const refine = (a: number, b: number): number => {
    // a and b bracket a visibility change; return the change instant (±10 s).
    let lo = a;
    let hi = b;
    const va = vis(a);
    for (let i = 0; i < 30 && hi - lo > 10_000; i++) {
      const m = (lo + hi) / 2;
      if (vis(m) === va) lo = m;
      else hi = m;
    }
    return Math.round((lo + hi) / 2 / 1000) * 1000;
  };
  const start = day.dayStart.getTime();
  const end = day.dayEnd.getTime();
  const step = stepMinutes * 60_000;
  const visible: Array<{ from: Date; to: Date }> = [];
  let open: number | null = vis(start) ? start : null;
  let prev = start;
  for (let t = start + step; t <= end; t += step) {
    const now = vis(t);
    if (open === null && now) open = refine(prev, t);
    else if (open !== null && !now) {
      visible.push({ from: new Date(open), to: new Date(refine(prev, t)) });
      open = null;
    }
    prev = t;
  }
  if (open !== null) visible.push({ from: new Date(open), to: new Date(end) });
  const firstLight = visible[0]?.from ?? null;
  const lastLight = visible[visible.length - 1]?.to ?? null;
  const tolerance = 3 * 60_000;
  const differs =
    (firstLight !== null &&
      day.sunrise !== null &&
      Math.abs(firstLight.getTime() - day.sunrise.getTime()) > tolerance) ||
    (lastLight !== null &&
      day.sunset !== null &&
      Math.abs(lastLight.getTime() - day.sunset.getTime()) > tolerance) ||
    (firstLight === null) !== (day.sunrise === null) ||
    visible.length > 1;
  return { visible, firstLight, lastLight, differsFromAstronomical: differs };
}

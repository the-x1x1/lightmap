/**
 * Apparent sizes (Phase 6 "the sun here in frame", night planning): how wide the Sun and the Moon
 * look from here, and which of the full Moons ahead are the big ones.
 *
 * The Moon's distance swings about ±5.5 % around its mean over the anomalistic month, so its disc
 * runs from ≈ 0.49° at apogee to ≈ 0.56° at perigee — a 14 % spread that decides how much of a
 * long lens's frame a Moon over a ridge fills, and which full Moon of the year is the one to book
 * the trip for. The Sun's varies only ±1.7 % with the Earth's orbit. Distances come from the same
 * Meeus series the positions use; the Moon's geocentric distance is corrected for the observer's
 * own offset from the Earth's centre when an elevation is given (the Moon is up to 1.7 % nearer,
 * and so wider, at the zenith than on the horizon). Pure, unit-tested.
 */
import { lunarEquatorial } from './lunar.ts';
import { nextMoonPhases } from './phases.ts';
import { julianCenturiesTT } from './time.ts';

const RAD = 180 / Math.PI;

export const SUN_RADIUS_KM = 695_700;
export const MOON_RADIUS_KM = 1737.4;
export const AU_KM = 149_597_870.7;
/** Mean Earth–Moon distance (semi-major axis of the lunar orbit, geocentric). */
export const MEAN_LUNAR_DISTANCE_KM = 384_399;
/** Mean Earth radius, for the observer's offset from the centre. */
const EARTH_RADIUS_KM = 6371;

/** Angular diameter in degrees of a sphere of `radiusKm` seen from `distanceKm`. */
export function apparentDiameterDeg(radiusKm: number, distanceKm: number): number {
  return 2 * Math.asin(Math.min(1, radiusKm / distanceKm)) * RAD;
}

/**
 * Distance from an observer on the surface to a body `geocentricKm` from the Earth's centre that
 * stands `elevationDeg` above the observer's horizon (topocentric elevation): the law of cosines
 * on centre–observer–body. At the zenith it is the geocentric distance less one Earth radius.
 */
export function topocentricDistanceKm(geocentricKm: number, elevationDeg: number): number {
  const h = Math.max(-90, Math.min(90, elevationDeg)) / RAD;
  const R = EARTH_RADIUS_KM;
  return Math.sqrt(geocentricKm * geocentricKm - R * R * Math.cos(h) ** 2) - R * Math.sin(h);
}

/**
 * The Moon's apparent diameter, degrees. With `elevationDeg` (the observer's topocentric
 * elevation of the Moon) the observer's offset from the Earth's centre is included; without it the
 * geocentric figure almanacs print.
 */
export function moonApparentDiameterDeg(distanceKm: number, elevationDeg?: number): number {
  const d =
    elevationDeg === undefined ? distanceKm : topocentricDistanceKm(distanceKm, elevationDeg);
  return apparentDiameterDeg(MOON_RADIUS_KM, d);
}

/** The Sun's apparent diameter, degrees, from the Earth–Sun distance in AU. */
export function sunApparentDiameterDeg(distanceAu: number): number {
  return apparentDiameterDeg(SUN_RADIUS_KM, distanceAu * AU_KM);
}

/**
 * How much wider (positive) or narrower (negative) the Moon's disc is than at its mean distance,
 * as a fraction: +0.07 at a close perigee, −0.06 at a far apogee. Angular size is inversely
 * proportional to distance to well within the rounding shown.
 */
export function moonSizeVsMean(distanceKm: number): number {
  return MEAN_LUNAR_DISTANCE_KM / distanceKm - 1;
}

export interface FullMoonSize {
  /** UTC instant of the full Moon. */
  at: Date;
  /** Geocentric distance at that instant, km. */
  distanceKm: number;
  /** `moonSizeVsMean` at that instant. */
  sizeVsMean: number;
}

export interface FullMoonsAhead {
  /** The next `count` full Moons in time order. */
  moons: FullMoonSize[];
  /** Index into `moons` of the closest (widest) one, or −1 when there are none. */
  closest: number;
  /** Index into `moons` of the farthest (narrowest) one, or −1 when there are none. */
  farthest: number;
}

/**
 * The next `count` full Moons after `from` with their distances — twelve cover the year ahead —
 * and which of them is the closest and the farthest. A full Moon within a day of perigee is what
 * the press calls a "supermoon"; the figures here say how much bigger it actually is (a close
 * one is about 7 % wider than average and 14 % wider than an apogee full Moon, never more).
 */
export function fullMoonsAhead(from: Date, count = 12): FullMoonsAhead {
  // Four principal phases per lunation; a little slack so the scan is never one short.
  const moons = nextMoonPhases(from, count * 4 + 3)
    .filter((e) => e.phase === 'full')
    .slice(0, count)
    .map((e) => {
      const distanceKm = lunarEquatorial(julianCenturiesTT(e.at)).distanceKm;
      return { at: e.at, distanceKm, sizeVsMean: moonSizeVsMean(distanceKm) };
    });
  let closest = -1;
  let farthest = -1;
  moons.forEach((m, i) => {
    if (closest < 0 || m.distanceKm < moons[closest]!.distanceKm) closest = i;
    if (farthest < 0 || m.distanceKm > moons[farthest]!.distanceKm) farthest = i;
  });
  return { moons, closest, farthest };
}

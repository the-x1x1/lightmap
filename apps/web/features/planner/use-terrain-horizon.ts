'use client';
/**
 * Samples the terrain horizon around the selected location through the running renderer and
 * stores the profile in the planner, so `buildSceneState` can say whether the Sun is behind the
 * ridge and when it clears it (`@lightmap/scene` `horizon.ts`).
 *
 * Cost: 120 azimuths × 22 rings = 2 640 terrain samples, taken at three tile levels (fine near
 * the eye, coarse far out) so the far rings do not pull hundreds of detailed tiles. One profile
 * per place is kept in memory; the store is cleared when the place changes so a stale profile
 * is never applied to a new pin.
 */
import { useEffect } from 'react';
import type { GeoPoint } from '@lightmap/geospatial';
import {
  horizonProfileFromSamples,
  horizonSamplePoints,
  type HorizonProfile,
} from '@lightmap/scene';
import { usePlannerStore } from './store';

export type SampleHeights = (
  points: readonly GeoPoint[],
  level: number,
) => Promise<Array<number | null>>;

export type SampleSurface = (points: readonly GeoPoint[]) => Promise<Array<number | null> | null>;

/** How far out mapped buildings join the profile, metres: a city block's skyline, not a distant ridge. */
export const BUILDINGS_REACH_M = 2500;
/** A mapped surface this much above the terrain at the pin is a roof the viewer stands on, metres. */
export const ROOF_MIN_M = 3;

/**
 * Mapped buildings near the pin folded into the terrain heights (in place): the topmost
 * surface (a roof) replaces the bare terrain where it stands higher. `surface[0]` is the pin
 * itself, the rest follow `near` (indices into `heights`). Nothing sampled (no tileset,
 * unsupported, every point missed) leaves the terrain alone and the caveat honest. A pin on a
 * footprint (geocoders land on building centroids) stands the viewer on that roof — otherwise
 * its own building, 40 m away on every bearing, would wall the whole sky — and says so.
 */
export function mergeSurface(
  terrainAtPin: number,
  heights: Array<number | null>,
  near: readonly number[],
  surface: ReadonlyArray<number | null> | null,
): { ground: number; buildingsReachM: number | null; onRoof: boolean } {
  if (!surface || !surface.some((h) => h !== null))
    return { ground: terrainAtPin, buildingsReachM: null, onRoof: false };
  const atPin = surface[0];
  const onRoof = atPin !== null && atPin !== undefined && atPin - terrainAtPin > ROOF_MIN_M;
  surface.slice(1).forEach((h, j) => {
    const i = near[j];
    if (h !== null && i !== undefined) heights[i] = Math.max(heights[i] ?? -Infinity, h);
  });
  return {
    ground: onRoof ? atPin : terrainAtPin,
    buildingsReachM: BUILDINGS_REACH_M,
    onRoof,
  };
}

const cache = new Map<string, HorizonProfile>();
/** Runs in flight by key, so a re-render (quality rung change, re-geocoded pin) joins the run
 * instead of restarting the 2 640 samples. */
const pending = new Map<string, Promise<HorizonProfile | null>>();
const MAX_CACHE = 24;
/** Below this share of answered samples the profile is not trusted (a hole could hide a ridge). */
const MIN_COVERAGE = 0.6;
/** The pin must stay this long (ms) before its horizon is sampled. */
export const HORIZON_SETTLE_MS = 350;

/** Terrain tile level per ring distance: DEM detail where it matters, cheap tiles far away. */
export function levelForDistance(distanceM: number): number {
  return distanceM <= 1500 ? 13 : distanceM <= 8000 ? 11 : 9;
}

export function useTerrainHorizon(input: {
  sampleHeights: SampleHeights | null;
  /** With 3D buildings configured: terrain-or-building heights near the pin; null otherwise. */
  sampleSurface?: SampleSurface | null;
  terrainAvailable: boolean;
  terrainProviderId: string;
  eyeHeightM: number;
}) {
  const { sampleHeights, terrainAvailable, terrainProviderId } = input;
  const sampleSurface = input.sampleSurface ?? null;
  const eyeHeightM = Math.round(input.eyeHeightM * 2) / 2;
  const location = usePlannerStore((s) => s.location);
  const setHorizonProfile = usePlannerStore((s) => s.setHorizonProfile);

  useEffect(() => {
    if (!location || !sampleHeights || !terrainAvailable) return;
    const key = `${terrainProviderId}${sampleSurface ? '+buildings' : ''}|${location.point.latitude.toFixed(5)},${location.point.longitude.toFixed(5)}|${eyeHeightM}`;
    const hit = cache.get(key);
    if (hit) {
      setHorizonProfile(hit);
      return;
    }
    let cancelled = false;
    const origin: GeoPoint = {
      latitude: location.point.latitude,
      longitude: location.point.longitude,
    };
    const run = async (): Promise<HorizonProfile | null> => {
      const pts = horizonSamplePoints(origin);
      const byLevel = new Map<number, number[]>();
      pts.forEach((p, i) => {
        const l = levelForDistance(p.distanceM);
        const list = byLevel.get(l);
        if (list) list.push(i);
        else byLevel.set(l, [i]);
      });
      const heights: Array<number | null> = new Array<number | null>(pts.length).fill(null);
      // The buildings (the near rings plus the pin itself) are sampled alongside the terrain
      // levels — the two are independent, and the building pass loads tiles.
      const near = sampleSurface
        ? pts.map((p, i) => (p.distanceM <= BUILDINGS_REACH_M ? i : -1)).filter((i) => i >= 0)
        : [];
      const surfaceJob = sampleSurface
        ? sampleSurface([origin, ...near.map((i) => pts[i]!.point)]).catch(() => null)
        : Promise.resolve(null);
      const groundJob = sampleHeights([origin], 13);
      const levelJobs = [...byLevel].map(async ([level, idx]) => {
        const res = await sampleHeights(
          idx.map((i) => pts[i]!.point),
          level,
        );
        res.forEach((h, j) => {
          heights[idx[j]!] = h;
        });
      });
      const [[terrainAtPin], surface] = await Promise.all([groundJob, surfaceJob, ...levelJobs]);
      // Without the ground height at the pin the eye's datum is unknown: no profile.
      if (terrainAtPin === null || terrainAtPin === undefined) return null;
      const { ground, buildingsReachM, onRoof } = mergeSurface(
        terrainAtPin,
        heights,
        near,
        surface,
      );
      const profile = horizonProfileFromSamples(
        origin,
        ground,
        eyeHeightM,
        pts.map((p, i) => ({
          azimuthDeg: p.azimuthDeg,
          distanceM: p.distanceM,
          heightM: heights[i] ?? null,
        })),
        {
          providerId: buildingsReachM ? `${terrainProviderId}+buildings` : terrainProviderId,
          resolutionM: null,
        },
        { buildingsReachM, onRoof },
      );
      // Too little data: no profile rather than a misleading one.
      if (profile.coverage < MIN_COVERAGE) return null;
      cache.set(key, profile);
      if (cache.size > MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return profile;
    };
    const start = () => {
      let job = pending.get(key);
      if (!job) {
        job = run()
          .catch(() => null) // tiles unavailable: the planner simply has no terrain horizon
          .finally(() => {
            pending.delete(key);
          });
        pending.set(key, job);
      }
      void job.then((profile) => {
        if (cancelled) return;
        if (profile) setHorizonProfile(profile);
        else {
          // No horizon here (tiles unavailable, too few samples): one kept from a few steps
          // back is not this place's either.
          const kept = usePlannerStore.getState().horizonProfile;
          if (
            kept &&
            (kept.origin.latitude !== origin.latitude || kept.origin.longitude !== origin.longitude)
          )
            setHorizonProfile(null);
        }
      });
    };
    // Once the pin has stayed put a moment: a walk moves it ten times a second, and each of the
    // 2,640-sample runs it started (and the 45-night dark-window scan each answer re-ran) loaded
    // terrain tiles for a place already left behind.
    const timer = setTimeout(start, HORIZON_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    location,
    sampleHeights,
    sampleSurface,
    terrainAvailable,
    terrainProviderId,
    eyeHeightM,
    setHorizonProfile,
  ]);
}

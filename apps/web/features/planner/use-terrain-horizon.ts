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

const cache = new Map<string, HorizonProfile>();
/** Runs in flight by key, so a re-render (quality rung change, re-geocoded pin) joins the run
 * instead of restarting the 2 640 samples. */
const pending = new Map<string, Promise<HorizonProfile | null>>();
const MAX_CACHE = 24;
/** Below this share of answered samples the profile is not trusted (a hole could hide a ridge). */
const MIN_COVERAGE = 0.6;

/** Terrain tile level per ring distance: DEM detail where it matters, cheap tiles far away. */
export function levelForDistance(distanceM: number): number {
  return distanceM <= 1500 ? 13 : distanceM <= 8000 ? 11 : 9;
}

export function useTerrainHorizon(input: {
  sampleHeights: SampleHeights | null;
  terrainAvailable: boolean;
  terrainProviderId: string;
  eyeHeightM: number;
}) {
  const { sampleHeights, terrainAvailable, terrainProviderId } = input;
  const eyeHeightM = Math.round(input.eyeHeightM * 2) / 2;
  const location = usePlannerStore((s) => s.location);
  const setHorizonProfile = usePlannerStore((s) => s.setHorizonProfile);

  useEffect(() => {
    if (!location || !sampleHeights || !terrainAvailable) return;
    const key = `${terrainProviderId}|${location.point.latitude.toFixed(5)},${location.point.longitude.toFixed(5)}|${eyeHeightM}`;
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
      const [ground] = await sampleHeights([origin], 13);
      // Without the ground height at the pin the eye's datum is unknown: no profile.
      if (ground === null || ground === undefined) return null;
      for (const [level, idx] of byLevel) {
        const res = await sampleHeights(
          idx.map((i) => pts[i]!.point),
          level,
        );
        res.forEach((h, j) => {
          heights[idx[j]!] = h;
        });
      }
      const profile = horizonProfileFromSamples(
        origin,
        ground,
        eyeHeightM,
        pts.map((p, i) => ({
          azimuthDeg: p.azimuthDeg,
          distanceM: p.distanceM,
          heightM: heights[i] ?? null,
        })),
        { providerId: terrainProviderId, resolutionM: null },
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
      if (!cancelled && profile) setHorizonProfile(profile);
    });
    return () => {
      cancelled = true;
    };
  }, [location, sampleHeights, terrainAvailable, terrainProviderId, eyeHeightM, setHorizonProfile]);
}

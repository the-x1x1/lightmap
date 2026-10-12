import { describe, expect, it } from 'vitest';
import {
  BUILDINGS_REACH_M,
  ROOF_MIN_M,
  mergeSurface,
} from '../../features/planner/use-terrain-horizon.ts';

describe('mapped buildings folded into the terrain horizon', () => {
  it('leaves the terrain alone when nothing was sampled', () => {
    const heights = [10, 12, null, 14];
    expect(mergeSurface(10, heights, [0, 1, 2, 3], null)).toEqual({
      ground: 10,
      buildingsReachM: null,
      onRoof: false,
    });
    expect(mergeSurface(10, heights, [0, 1, 2, 3], [null, null, null, null, null])).toEqual({
      ground: 10,
      buildingsReachM: null,
      onRoof: false,
    });
    expect(heights).toEqual([10, 12, null, 14]);
  });

  it('takes a roof where it stands higher than the terrain, keeps the terrain elsewhere', () => {
    const heights = [10, 12, null, 14, 20];
    // surface[0] is the pin (street level), then the near points 1, 2, 3.
    const r = mergeSurface(10, heights, [1, 2, 3], [10.5, 40, null, 9]);
    expect(r).toEqual({ ground: 10, buildingsReachM: BUILDINGS_REACH_M, onRoof: false });
    // A 40 m roof replaces 12; a missed point keeps null; a surface below the terrain is ignored;
    // points beyond the reach are untouched.
    expect(heights).toEqual([10, 40, null, 14, 20]);
  });

  it('a pin on a footprint stands the viewer on that roof', () => {
    const heights = [12, 13];
    const r = mergeSurface(10, heights, [0, 1], [10 + ROOF_MIN_M + 20, 30, 30]);
    expect(r).toEqual({ ground: 33, buildingsReachM: BUILDINGS_REACH_M, onRoof: true });
    // Just a kerb's worth above the terrain is not a roof.
    expect(mergeSurface(10, [12], [0], [10 + ROOF_MIN_M - 1, 12]).onRoof).toBe(false);
  });
});

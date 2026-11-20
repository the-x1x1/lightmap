import { describe, expect, it } from 'vitest';
import { groundShadowMode } from '../src/cesium/cesium-host.ts';

describe('ground shadows', () => {
  class EllipsoidTerrainProvider {}
  class OtherTerrain {}
  const C = {
    ShadowMode: { DISABLED: 0, ENABLED: 1, CAST_ONLY: 2, RECEIVE_ONLY: 3 },
    EllipsoidTerrainProvider,
  };

  it('has the ellipsoid receive shadows and cast none; real terrain does both', () => {
    expect(groundShadowMode(C as never, new EllipsoidTerrainProvider())).toBe(3);
    expect(groundShadowMode(C as never, new OtherTerrain())).toBe(1);
    // Nothing set yet reads as terrain to come: it casts, as before.
    expect(groundShadowMode(C as never, undefined)).toBe(1);
  });

  it('has the flat chart of the night map cast none, whatever its terrain', () => {
    // A globe that casts is lit by the shadow shader: the chart went black under a bright Moon.
    expect(groundShadowMode(C as never, new OtherTerrain(), false)).toBe(3);
    expect(groundShadowMode(C as never, new EllipsoidTerrainProvider(), false)).toBe(3);
    expect(groundShadowMode(C as never, new OtherTerrain(), true)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { detectCapabilities, qualityCeiling, resolveRenderMode } from '../src/capabilities.ts';
import { QUALITY_LADDER } from '../src/quality-governor.ts';
import { pickSurface } from '../src/pick.ts';

function fakeGl(renderer: string, maxTex = 8192) {
  let lost = false;
  return {
    RENDERER: 0x1f01,
    MAX_TEXTURE_SIZE: 0x0d33,
    getExtension: (name: string) =>
      name === 'WEBGL_debug_renderer_info'
        ? { UNMASKED_RENDERER_WEBGL: 0x9246 }
        : name === 'WEBGL_lose_context'
          ? {
              loseContext: () => {
                lost = true;
              },
            }
          : null,
    getParameter: (p: number) =>
      p === 0x9246 || p === 0x1f01 ? renderer : p === 0x0d33 ? maxTex : null,
    get lost() {
      return lost;
    },
  };
}

describe('detectCapabilities (ported from WorldView)', () => {
  it('reports WebGL2, GPU string and releases the probe context', () => {
    const gl = fakeGl('ANGLE (Apple, Apple M2)');
    const caps = detectCapabilities({
      createCanvas: () => ({
        getContext: (k) => (k === 'webgl2' ? (gl as unknown as WebGL2RenderingContext) : null),
      }),
      hardwareConcurrency: 8,
      matchMedia: () => ({ matches: false }),
      devicePixelRatio: 2,
    });
    expect(caps.webgl2).toBe(true);
    expect(caps.gpu).toBe('ANGLE (Apple, Apple M2)');
    expect(caps.lowPower).toBe(false);
    expect(caps.maxTextureSize).toBe(8192);
    expect(gl.lost).toBe(true);
    expect(resolveRenderMode(caps)).toBe('3D');
    expect(qualityCeiling(caps, QUALITY_LADDER)).toBe(0);
  });
  it('no WebGL2 → overlay mode; low-power heuristics cap quality', () => {
    const none = detectCapabilities({ createCanvas: () => ({ getContext: () => null }) });
    expect(none.webgl2).toBe(false);
    expect(resolveRenderMode(none)).toBe('OVERLAY');
    expect(resolveRenderMode(none, '3D')).toBe('OVERLAY');
    const gl = fakeGl('SwiftShader', 2048);
    const weak = detectCapabilities({
      createCanvas: () => ({ getContext: () => gl as unknown as WebGL2RenderingContext }),
      hardwareConcurrency: 2,
      matchMedia: (q) => ({ matches: q.includes('reduce') }),
    });
    expect(weak.lowPower).toBe(true);
    expect(weak.reducedMotion).toBe(true);
    expect(qualityCeiling(weak, QUALITY_LADDER)).toBe(2);
    const smallTex = detectCapabilities({
      createCanvas: () => ({
        getContext: () => fakeGl('Good GPU', 2048) as unknown as WebGL2RenderingContext,
      }),
      hardwareConcurrency: 16,
    });
    expect(qualityCeiling(smallTex, QUALITY_LADDER)).toBe(1);
  });
  it('survives a throwing canvas', () => {
    expect(
      detectCapabilities({
        createCanvas: () => {
          throw new Error('no');
        },
      }).webgl2,
    ).toBe(false);
  });
});

describe('pickSurface (ported from WorldView)', () => {
  const toCarto = (c: { x: number; y: number; z: number }) => ({
    latitude: c.y,
    longitude: c.x,
    height: c.z,
  });
  it('prefers terrain depth picks and reports elevation', () => {
    const p = pickSurface(
      {
        pickPositionSupported: true,
        pickPosition: () => ({ x: 0.5, y: 0.25, z: 120 }),
        pickEllipsoid: () => ({ x: 9, y: 9, z: 0 }),
        toCartographic: toCarto,
      },
      { x: 1, y: 1 },
    );
    expect(p).toMatchObject({ viaTerrain: true, elevationM: 120 });
    expect(p!.latitude).toBeCloseTo(0.25 * (180 / Math.PI), 9);
  });
  it('falls back to the ellipsoid and returns null for sky', () => {
    const p = pickSurface(
      {
        pickPositionSupported: true,
        pickPosition: () => undefined,
        pickEllipsoid: () => ({ x: 0.1, y: 0.2, z: 0 }),
        toCartographic: toCarto,
      },
      { x: 1, y: 1 },
    );
    expect(p).toMatchObject({ viaTerrain: false });
    expect(p!.elevationM).toBeUndefined();
    expect(
      pickSurface(
        {
          pickPositionSupported: false,
          pickPosition: () => undefined,
          pickEllipsoid: () => undefined,
          toCartographic: toCarto,
        },
        { x: 1, y: 1 },
      ),
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  LIT_INSTANCE_FS,
  PRIMITIVE_NORMAL_SHADING_SMOOTH,
  litInstanceShader,
  treeFragmentShader,
} from '../src/cesium/osm-buildings-layer.ts';

describe('buildings and trees shader', () => {
  it('is plain ASCII in every variant', () => {
    for (const src of [
      LIT_INSTANCE_FS,
      litInstanceShader(0.2, 8000),
      treeFragmentShader(0.3, 0.7, 0.45, 20000),
    ]) {
      expect([...src].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
    }
  });

  it('divides out the shadow map darkness only within its distance', () => {
    const src = litInstanceShader(0.2, 8000);
    expect(src).toContain(`/ ${PRIMITIVE_NORMAL_SHADING_SMOOTH.toFixed(3)}, 0.0, 1.0), 0.200)`);
    expect(src).toContain('if (-v_positionEC.z < 8000.0) outRgb /= expected;');
  });

  it('takes the direction of the light from the direct share, keeping the level of a roof', () => {
    // A clear day: the Sun's whole term is directional, nothing moved to the sky.
    const clear = litInstanceShader(0.2, 8000, true, 1);
    expect(clear).toContain('0.55 * 1.00 * sun');
    expect(clear).toContain('0.55 * (1.0 - 1.00)');
    // An overcast: a fifth of it directional; the rest from the sky, by how much a face looks
    // up (a flat roof, sky = 1 and sun = sunUp, gets exactly its 0.55 * sunUp back), and the
    // ground's bounce under the faces that look down is left as it was.
    const overcast = litInstanceShader(0.2, 8000, true, 0.2);
    expect(overcast).toContain('0.55 * 0.20 * sun');
    expect(overcast).toContain(
      'float diffuseSun = 0.55 * (1.0 - 0.20) * sunUp * (0.5 + 0.5 * sky);',
    );
    expect(overcast).toContain('float bounce = 0.12 * (1.0 - sky) * sunUp;');
    // The trees take the same, the default (no share given) is a clear day's.
    expect(treeFragmentShader(1, 0, 1, 0, 1, 0.3)).toContain('0.55 * 0.30 * sun');
    expect(LIT_INSTANCE_FS).toContain('0.55 * 1.00 * sun');
    // In twilight the sky terms rise with the ground's (globeLightSplit's skyLift), held to 3.4.
    expect(LIT_INSTANCE_FS).toContain('(0.16 + 0.14 * sky) * 1.00');
    expect(litInstanceShader(1, 0, true, 0.2, 3.33)).toContain('(0.16 + 0.14 * sky) * 3.33');
    expect(treeFragmentShader(1, 0, 1, 0, 1, 0.2, 9)).toContain('(0.16 + 0.14 * sky) * 3.40');
  });

  it('compensates nothing with shadows off', () => {
    // Darkness 1 makes the expected factor 1, and a zero distance skips the division.
    expect(LIT_INSTANCE_FS).toContain('0.0, 1.0), 1.000)');
    expect(LIT_INSTANCE_FS).toContain('if (-v_positionEC.z < 0.0)');
  });

  it('keeps the leaf season in the trees and floors a black shadow', () => {
    const tree = treeFragmentShader(0.5, 0.5, 0, 100);
    expect(tree).toContain('v_color.a < 0.995');
    expect(tree).toContain('0.050)');
  });

  it('gives the season to the deciduous share of crowns only', () => {
    expect(treeFragmentShader(0.5, 0.5)).not.toContain('11.1');
    expect(treeFragmentShader(0, 0, 1, 0, 0.35)).toContain(
      'if (v_color.a < 0.995 && fract(h * 11.1) < 0.350)',
    );
  });

  it('darkens roofs on buildings only', () => {
    expect(litInstanceShader(0.2, 8000, true)).toContain('roofness');
    expect(litInstanceShader(0.2, 8000)).not.toContain('roofness');
    expect(treeFragmentShader(1, 0, 0.2, 8000)).not.toContain('roofness');
  });
});

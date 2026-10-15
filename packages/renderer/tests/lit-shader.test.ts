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

  it('darkens roofs on buildings only', () => {
    expect(litInstanceShader(0.2, 8000, true)).toContain('roofness');
    expect(litInstanceShader(0.2, 8000)).not.toContain('roofness');
    expect(treeFragmentShader(1, 0, 0.2, 8000)).not.toContain('roofness');
  });
});

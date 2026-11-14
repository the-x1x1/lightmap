import { describe, expect, it } from 'vitest';
import {
  SHADOW_APPLY_LINE,
  SHADOW_TINT_GLSL,
  installShadowTint,
  tintShadowSource,
} from '../src/cesium/shadow-tint.ts';

describe('shadow tint', () => {
  it('tints the last line of the receive shader, and nothing else', () => {
    const src = { sources: ['void a() {}', `void main() {\n    ${SHADOW_APPLY_LINE}\n}`] };
    tintShadowSource(src);
    expect(src.sources[0]).toBe('void a() {}');
    expect(src.sources[1]).toContain('lmTint');
    expect(src.sources[1]).not.toContain(SHADOW_APPLY_LINE);
    const other = { sources: ['void main() { out_FragColor = vec4(1.0); }'] };
    tintShadowSource(other);
    expect(other.sources[0]).not.toContain('lmTint');
  });

  it('wraps the factory once and leaves a Cesium without one alone', () => {
    let calls = 0;
    const C = {
      ShadowMapShader: {
        createShadowReceiveFragmentShader: () => {
          calls++;
          return { sources: [SHADOW_APPLY_LINE] };
        },
      },
    };
    expect(installShadowTint(C)).toBe(true);
    expect(installShadowTint(C)).toBe(true);
    const out = C.ShadowMapShader.createShadowReceiveFragmentShader();
    expect(calls).toBe(1);
    expect(out.sources[0]).toContain('lmShade');
    expect(installShadowTint({})).toBe(false);
  });

  it('is ASCII', () => {
    expect([...SHADOW_TINT_GLSL].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});

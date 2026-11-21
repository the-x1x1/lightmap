import { describe, expect, it } from 'vitest';
import {
  SHADOW_APPLY_LINE,
  SHADOW_TINT_GLSL,
  SHADOW_TINT_SUN_IMAGE_GLSL,
  carriesSunImage,
  installShadowTint,
  tintShadowSource,
} from '../src/cesium/shadow-tint.ts';
import { GROUND_MATERIAL_SOURCE, SUN_IMAGE_GLOBAL } from '../src/shaders/ground.frag.ts';

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

  it('takes the light’s own image out of the shade where the material records it', () => {
    // The ground material declares it (before its function) and sets it.
    expect(GROUND_MATERIAL_SOURCE).toContain(`vec3 ${SUN_IMAGE_GLOBAL} = vec3(0.0);`);
    expect(GROUND_MATERIAL_SOURCE.split(`${SUN_IMAGE_GLOBAL} `).length).toBeGreaterThan(4);
    const ground = {
      sources: [
        GROUND_MATERIAL_SOURCE,
        'void globe() {}',
        `void main() {\n    ${SHADOW_APPLY_LINE}\n}`,
      ],
    };
    tintShadowSource(ground);
    expect(ground.sources[2]).toContain('lmImage');
    expect(ground.sources[2]).toContain('lmTint');
    // Any other receiver (buildings, trees): the tint alone.
    const building = { sources: ['void model() {}', `void main() {\n    ${SHADOW_APPLY_LINE}\n}`] };
    tintShadowSource(building);
    expect(building.sources[1]).toContain('lmTint');
    expect(building.sources[1]).not.toContain('lmImage');
    // The name only counts declared before the main, as a declaration.
    expect(carriesSunImage([`float x = ${SUN_IMAGE_GLOBAL}x;`, 'main'])).toBe(false);
    expect(carriesSunImage(['main', `vec3 ${SUN_IMAGE_GLOBAL} = vec3(0.0);`])).toBe(false);
  });

  it('puts the image back by how much of the light reaches the spot', () => {
    // The GLSL's arithmetic, step by step: darkness 0.35, an image of 4 (four times white).
    const shade = (vis: number, dark = 0.35) =>
      Math.min(1, Math.max(0, (1 - vis) / Math.max(1 - dark, 1e-3)));
    const out = (rgb: number, image: number, vis: number) => {
      const img = Math.min(image, rgb);
      return (rgb - img) * vis + img * (1 - shade(vis));
    };
    expect(out(4.3, 4, 1)).toBeCloseTo(4.3, 9); // in the light: as before
    expect(out(4.3, 4, 0.35)).toBeCloseTo(0.3 * 0.35, 9); // in full shadow: no Sun in it
    expect(out(4.3, 4, 0.675)).toBeCloseTo(0.3 * 0.675 + 4 * 0.5, 9); // half way along an edge
    expect(out(0.2, 4, 0.35)).toBeCloseTo(0, 9); // never more taken than is there
    expect(SHADOW_TINT_SUN_IMAGE_GLSL).toContain('(1.0 - lmShade)');
  });

  it('is ASCII', () => {
    expect([...SHADOW_TINT_GLSL].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect([...SHADOW_TINT_SUN_IMAGE_GLSL].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});

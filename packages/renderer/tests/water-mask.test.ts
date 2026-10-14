import { describe, expect, it } from 'vitest';
import {
  GLOBE_MASK_SAMPLE_LINE,
  SMOOTH_WATER_MASK_GLSL,
  patchGlobeFragmentSource,
} from '../src/water-mask.ts';

const globeFs = `uniform sampler2D u_waterMask;
float helper() { return 1.0; }
void main()
{
    vec2 waterMaskTextureCoordinates = vec2(0.5);
    ${GLOBE_MASK_SAMPLE_LINE}
    out_FragColor = vec4(mask);
}`;

describe('water mask smoothing patch', () => {
  it('reads the mask through the smoothing function, defined before main', () => {
    const out = patchGlobeFragmentSource(globeFs)!;
    expect(out).not.toContain(GLOBE_MASK_SAMPLE_LINE);
    expect(out).toContain('float mask = lmSmoothWaterMask(waterMaskTextureCoordinates);');
    expect(out.indexOf('float lmSmoothWaterMask(vec2 uv)')).toBeLessThan(
      out.indexOf('void main()'),
    );
    // Applying twice changes nothing.
    expect(patchGlobeFragmentSource(out)).toBe(out);
  });

  it('leaves an unfamiliar source alone', () => {
    expect(patchGlobeFragmentSource('void main() {}')).toBeNull();
    expect(patchGlobeFragmentSource(`${GLOBE_MASK_SAMPLE_LINE}`)).toBeNull();
  });

  it('is plain ASCII GLSL guarded by the same defines as the mask uniform', () => {
    expect([...SMOOTH_WATER_MASK_GLSL].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(SMOOTH_WATER_MASK_GLSL).toContain(
      '#if defined(HAS_WATER_MASK) && (defined(SHOW_REFLECTIVE_OCEAN) || defined(APPLY_MATERIAL))',
    );
  });

  it('keeps a straight coast where it was and rounds a corner (the shader maths, in JS)', () => {
    // A binary mask, water where x < 10 (texel units), sampled bilinearly like the GPU.
    const water = (x: number, y: number) => (x < 10 ? 1 : 0) * (y < 1000 ? 1 : 1);
    const bilinear = (f: (x: number, y: number) => number, x: number, y: number) => {
      const x0 = Math.floor(x - 0.5);
      const y0 = Math.floor(y - 0.5);
      const fx = x - 0.5 - x0;
      const fy = y - 0.5 - y0;
      const v = (i: number, j: number) => f(x0 + i, y0 + j);
      return (
        (v(0, 0) * (1 - fx) + v(1, 0) * fx) * (1 - fy) + (v(0, 1) * (1 - fx) + v(1, 1) * fx) * fy
      );
    };
    const ss = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const smooth = (f: (x: number, y: number) => number, x: number, y: number) => {
      let s = 4 * bilinear(f, x, y);
      for (let i = 0; i < 8; i++) {
        const a = i * 0.785398;
        s += 2 * bilinear(f, x + Math.cos(a) * 0.75, y + Math.sin(a) * 0.75);
        s += bilinear(f, x + Math.cos(a + 0.392699) * 1.5, y + Math.sin(a + 0.392699) * 1.5);
      }
      const b = s / 28;
      return Math.max(ss(0.38, 0.62, b), 0.45 * ss(0.08, 0.38, b) * ss(0.62, 0.38, b));
    };
    // Straight coast: half-way at the same place, sharper than the raw ramp.
    expect(smooth(water, 10, 5)).toBeCloseTo(0.5, 1);
    expect(smooth(water, 8.5, 5)).toBeGreaterThan(0.99);
    expect(smooth(water, 11.5, 5)).toBeLessThan(0.01);
    // A one-texel square bay corner: the staircase's inner corner is filled in partly.
    const corner = (x: number, y: number) => (x < 10 || y < 10 ? 1 : 0);
    expect(smooth(corner, 10.4, 10.4)).toBeGreaterThan(bilinear(corner, 10.4, 10.4) - 0.5);
  });
});

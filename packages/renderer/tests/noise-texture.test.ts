import { describe, expect, it } from 'vitest';
import { NOISE_TEXTURE_SIZE, makeNoiseTexture } from '../src/noise-texture.ts';
import { packDetailLuminance } from '../src/cesium/detail-tiles.ts';
import { FrameRateSampler } from '../src/frame-sampler.ts';

describe('baked noise texture', () => {
  const size = 64;
  const tex = makeNoiseTexture(size);
  const at = (x: number, y: number, c: number) => tex[(y * size + x) * 4 + c]!;

  it('is deterministic and the expected size', () => {
    expect(tex.length).toBe(size * size * 4);
    expect(makeNoiseTexture(size)).toEqual(tex);
    expect(makeNoiseTexture().length).toBe(NOISE_TEXTURE_SIZE * NOISE_TEXTURE_SIZE * 4);
  });

  it('tiles: the last column and row run on into the first like any two neighbours', () => {
    for (let c = 0; c < 4; c++) {
      let inside = 0;
      let across = 0;
      for (let i = 0; i < size; i++) {
        for (let x = 0; x < size - 1; x++)
          inside = Math.max(inside, Math.abs(at(x + 1, i, c) - at(x, i, c)));
        across = Math.max(across, Math.abs(at(size - 1, i, c) - at(0, i, c)));
        across = Math.max(across, Math.abs(at(i, size - 1, c) - at(i, 0, c)));
      }
      expect(across).toBeLessThanOrEqual(inside + 2);
    }
    // At full size the fractal is smooth texel to texel, the wrap included.
    const big = makeNoiseTexture();
    const n = NOISE_TEXTURE_SIZE;
    for (let i = 0; i < n; i++) {
      expect(Math.abs(big[(i * n + n - 1) * 4]! - big[i * n * 4]!)).toBeLessThan(24);
      expect(Math.abs(big[((n - 1) * n + i) * 4]! - big[i * 4]!)).toBeLessThan(24);
    }
  });

  it('has the means the shader assumes (fractal ~0.47, value noise ~0.5) and a spread', () => {
    for (const [c, mean] of [
      [0, 0.47],
      [1, 0.5],
      [2, 0.47],
      [3, 0.5],
    ] as const) {
      let sum = 0;
      let min = 255;
      let max = 0;
      for (let i = 0; i < size * size; i++) {
        const v = tex[i * 4 + c]!;
        sum += v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      expect(sum / (size * size) / 255).toBeGreaterThan(mean - 0.08);
      expect(sum / (size * size) / 255).toBeLessThan(mean + 0.08);
      expect(max - min).toBeGreaterThan(100);
    }
    // The channels are independent fields, not copies.
    let same = 0;
    for (let i = 0; i < size * size; i++) if (tex[i * 4] === tex[i * 4 + 2]) same++;
    expect(same).toBeLessThan(size * size * 0.1);
  });
});

describe('detail luminance packing', () => {
  it('puts each quadrant in its channel, normalised to a mean of 0.5', () => {
    const tile = 4;
    const w = tile * 2;
    const rgba = new Uint8Array(w * w * 4);
    // Quadrant brightness: NW 40, NE 120, SW 200 (all grey), SE striped 0/250.
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const q = (y >= tile ? 2 : 0) + (x >= tile ? 1 : 0);
        const v = q === 0 ? 40 : q === 1 ? 120 : q === 2 ? 200 : x % 2 ? 250 : 0;
        rgba.set([v, v, v, 255], (y * w + x) * 4);
      }
    const out = packDetailLuminance(rgba, tile);
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = 0; i < tile * tile; i++) sum += out[i * 4 + c]!;
      expect(Math.abs(sum / (tile * tile) - 127.5)).toBeLessThanOrEqual(1);
    }
    // The striped quadrant keeps its contrast; the flat ones are flat.
    expect(new Set([0, 1, 2, 3].map((i) => out[i * 4 + 3]))).toEqual(new Set([0, 255]));
    expect(out[1]).toBe(out[5]);
  });
});

describe('frame-rate sampler', () => {
  it('times only consecutive moving frames', () => {
    const s = new FrameRateSampler(1000, 12, 250);
    const out: number[] = [];
    // A one-second drag at 60 frames a second.
    for (let i = 0; i <= 70; i++) {
      const v = s.frame(i * (1000 / 60), true);
      if (v !== null) out.push(v);
    }
    expect(out.length).toBe(1);
    expect(out[0]).toBeCloseTo(60, 0);
  });

  it('ignores frames drawn for tiles while the camera is still (on-demand rendering)', () => {
    const s = new FrameRateSampler(1000, 12, 250);
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += 66; // 15 frames a second, camera still
      expect(s.frame(t, false)).toBeNull();
    }
  });

  it('treats a long gap as a pause, and needs enough motion for a sample', () => {
    const s = new FrameRateSampler(1000, 12, 250);
    const out: Array<number | null> = [];
    let t = 0;
    for (let i = 0; i < 8; i++) out.push(s.frame((t += 16), true));
    t += 2000; // paused
    for (let i = 0; i < 8; i++) out.push(s.frame((t += 16), true));
    expect(out.filter((v) => v !== null)).toEqual([]);
  });

  it('reports a slow machine as slow', () => {
    const s = new FrameRateSampler(1000, 12, 250);
    let got: number | null = null;
    for (let i = 0; i <= 30 && got === null; i++) got = s.frame(i * 50, true);
    expect(got).toBeCloseTo(20, 0);
  });
});

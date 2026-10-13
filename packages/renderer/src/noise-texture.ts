/**
 * The ground material's noise, baked once into a small wrapping texture instead of computed per
 * fragment. Procedural value noise in the shader cost eight hashes per octave per sample, four
 * octaves per fractal, at half a dozen sites: the program took ~1.7 s to compile on a Windows PC
 * (every new terrain-tile variant stalled the view for a fraction of a second) and, with no mip
 * chain, the finer octaves shimmered at a distance. A texture sample is one fetch, filtered and
 * mipmapped by the GPU, so far-off noise settles to its mean instead of aliasing.
 *
 * Four channels, each tileable over the texture (the lattice wraps), so the sampler can REPEAT:
 * - R: four-octave fractal (8, 16, 32, 64 cells across; weights ½…1/16, mean ≈ 0.47) — the
 *   macro patches, the grain, the clouds, the coast's broad jitter.
 * - G: one octave of value noise, 64 cells across — the mottling and the coast's fine jitter.
 * - B: the same fractal as R from another seed — forest crowns, and a second, rotated sample
 *   against visible repetition.
 * - A: one octave, 64 cells, another seed.
 */

export const NOISE_TEXTURE_SIZE = 256;
/** Cells across the texture of the single-octave channels (G, A). */
export const NOISE_VALUE_CELLS = 64;
/** Cells across the texture of the fractal's base octave (R, B). */
export const NOISE_FBM_BASE_CELLS = 8;

/** Deterministic lattice values in [0, 1): mulberry32 seeded per channel. */
function lattice(cells: number, seed: number): Float32Array {
  const out = new Float32Array(cells * cells);
  let a = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return out;
}

/** One octave of tileable value noise sampled at pixel centres of a `size` × `size` image. */
function octave(size: number, cells: number, seed: number): Float32Array {
  const lat = lattice(cells, seed);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = ((y + 0.5) * cells) / size;
    const iy = Math.floor(fy);
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    const y0 = (iy % cells) * cells;
    const y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = ((x + 0.5) * cells) / size;
      const ix = Math.floor(fx);
      let tx = fx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells;
      const x1 = (ix + 1) % cells;
      const a = lat[y0 + x0]! + (lat[y0 + x1]! - lat[y0 + x0]!) * tx;
      const b = lat[y1 + x0]! + (lat[y1 + x1]! - lat[y1 + x0]!) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function fractal(size: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let weight = 0.5;
  for (let o = 0; o < 4; o++) {
    const n = octave(size, NOISE_FBM_BASE_CELLS << o, seed + o * 7919);
    for (let i = 0; i < out.length; i++) out[i]! += weight * n[i]!;
    weight *= 0.5;
  }
  return out;
}

/** The RGBA bytes of the noise texture, row by row (`size` × `size` × 4). */
export function makeNoiseTexture(size: number = NOISE_TEXTURE_SIZE): Uint8Array {
  const channels = [
    fractal(size, 1013),
    octave(size, NOISE_VALUE_CELLS, 2027),
    fractal(size, 3041),
    octave(size, NOISE_VALUE_CELLS, 4057),
  ];
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++)
    for (let c = 0; c < 4; c++)
      out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(channels[c]![i]! * 255)));
  return out;
}

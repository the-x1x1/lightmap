/**
 * Ground detail atlas (texture pack stage 3, `ROADMAP.md` Phase 4): four tileable detail
 * textures — grass, rock, sand, snow — in one 2 × 2 atlas (`apps/web/public/textures/
 * ground-detail.png`, 512 × 512, each tile 256 px over a 2.5 m period ≈ 1 cm per pixel) that
 * the ground material lays over the terrain within a few hundred metres of a viewpoint.
 *
 * Generated, not photographed: periodic value noise on a torus so every tile wraps without a
 * seam, shaped per surface (blades and clumps for grass, fractured faces and cracks for rock,
 * fine grain and ripples for sand, soft lumps with a cool shadow for snow), normalised to a mean
 * near 0.5 so the material can use it as a multiplier without shifting the macro colour. The
 * script is deterministic (a fixed seed), dependency-free (its own PNG encoder over `zlib`),
 * and the atlas it writes is committed; re-run `pnpm textures:ground` after changing it. A
 * photographic CC0 set (e.g. ambientCG's Grass/Rock/Ground/Snow, CC0 1.0) can replace the file
 * as long as the quadrant order (grass NW, rock NE, sand SW, snow SE) and the wrap are kept —
 * record the source in `DATA_SOURCES_AND_LICENSING.md` when you do.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

const TILE = 256;
const ATLAS = TILE * 2;
const OUT = join(process.cwd(), 'apps/web/public/textures/ground-detail.png');

// --- periodic value noise -------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374_761_393 + y * 668_265_263 + seed * 1_013_904_223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise with the lattice wrapped at `period` cells, so the result tiles. */
function noise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise over `octaves`, period doubling each octave; 0..~1. */
function fbm(
  u: number,
  v: number,
  basePeriod: number,
  octaves: number,
  seed: number,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u * period, v * period, period, seed + o * 17);
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  return sum / norm;
}

/** Ridged noise (1 − |2n − 1|), for cracks and crests. */
function ridged(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(2 * noise(u * period, v * period, period, seed + o * 31) - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.55;
    period *= 2;
  }
  return sum / norm;
}

type Rgb = [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// --- the four surfaces (u, v in 0..1, each wraps) ------------------------------------------

function grass(u: number, v: number): Rgb {
  // Clumps, then blades: thin bright streaks with a slight lean, over a darker mat.
  const clump = fbm(u, v, 6, 3, 1);
  const blades = ridged(u + 0.15 * v, v * 1.6, 48, 3, 2);
  const fine = fbm(u, v, 96, 2, 3);
  const dark: Rgb = [0.16, 0.26, 0.09];
  const light: Rgb = [0.58, 0.66, 0.28];
  let c = mix(dark, light, clamp01(0.1 + 0.8 * blades * blades + 0.5 * (clump - 0.5)));
  c = mix(c, [0.6, 0.58, 0.3], clamp01((fine - 0.6) * 1.5)); // the odd dry blade
  return c;
}

function rock(u: number, v: number): Rgb {
  // Fractured faces (cells of tone), cracks between them, and a mineral speckle.
  const faces = fbm(u, v, 5, 3, 11, 0.6);
  const facets = fbm(u + 0.3, v, 12, 2, 14);
  const crack = ridged(u, v, 7, 4, 12);
  const speck = fbm(u, v, 128, 2, 13);
  const dark: Rgb = [0.36, 0.34, 0.32];
  const light: Rgb = [0.66, 0.62, 0.56];
  let c = mix(dark, light, clamp01(0.15 + 1.4 * (faces - 0.35) + 0.5 * (facets - 0.5)));
  c = mix(c, [0.18, 0.17, 0.16], clamp01(Math.pow(crack, 2) * 1.6 - 0.25));
  c = mix(c, [0.74, 0.72, 0.66], clamp01((speck - 0.64) * 3));
  return c;
}

function sand(u: number, v: number): Rgb {
  // Ripples with a fine grain and a few darker specks.
  const ripple = 0.5 + 0.5 * Math.sin((u * 7 + 1.1 * fbm(u, v, 3, 2, 21)) * Math.PI * 2);
  const grain = fbm(u, v, 160, 2, 22);
  const speck = fbm(u, v, 256, 1, 23);
  const base: Rgb = [0.76, 0.68, 0.5];
  const shade: Rgb = [0.62, 0.55, 0.4];
  let c = mix(shade, base, 0.55 + 0.45 * ripple);
  c = mix(c, [0.85, 0.78, 0.6], clamp01((grain - 0.5) * 1.2));
  c = mix(c, [0.4, 0.34, 0.26], clamp01((speck - 0.72) * 3));
  return c;
}

function snow(u: number, v: number): Rgb {
  // Soft lumps lit from above-left with a cool shadow, and a sparkle of crystals.
  const lump = fbm(u, v, 4, 4, 31, 0.6);
  const lumpL = fbm(u - 0.004, v - 0.004, 4, 4, 31, 0.6);
  const lit = clamp01(0.5 + (lump - lumpL) * 18);
  const sparkle = fbm(u, v, 256, 1, 32);
  const shadow: Rgb = [0.72, 0.78, 0.9];
  const bright: Rgb = [0.96, 0.97, 0.99];
  let c = mix(shadow, bright, 0.3 + 0.7 * lit);
  c = mix(c, [1, 1, 1], clamp01((sparkle - 0.8) * 5));
  return c;
}

// --- atlas + PNG ------------------------------------------------------------------------------

const px = new Uint8Array(ATLAS * ATLAS * 3);
const surfaces: Array<[(u: number, v: number) => Rgb, number, number]> = [
  [grass, 0, 0],
  [rock, TILE, 0],
  [sand, 0, TILE],
  [snow, TILE, TILE],
];
for (const [fn, ox, oy] of surfaces) {
  // Normalise each tile's luminance toward a 0.5 mean, keeping its hue, so the shader can use
  // it as a multiplier (× 2) without shifting the colours the macro rules chose.
  const tile: Rgb[] = [];
  let mean = 0;
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const c = fn(x / TILE, y / TILE);
      tile.push(c);
      mean += 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    }
  mean /= TILE * TILE;
  const k = 0.5 / mean;
  tile.forEach((c, i) => {
    const x = ox + (i % TILE);
    const y = oy + Math.floor(i / TILE);
    const o = (y * ATLAS + x) * 3;
    px[o] = Math.round(clamp01(c[0] * k) * 255);
    px[o + 1] = Math.round(clamp01(c[1] * k) * 255);
    px[o + 2] = Math.round(clamp01(c[2] * k) * 255);
  });
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

mkdirSync(dirname(OUT), { recursive: true });
const bytes = png(ATLAS, ATLAS, px);
writeFileSync(OUT, bytes);
console.log(`wrote ${OUT} (${ATLAS} × ${ATLAS}, ${(bytes.length / 1024).toFixed(0)} KB)`);

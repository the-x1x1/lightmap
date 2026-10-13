/**
 * The ground's textures on the GPU: the detail tiles (texture pack stage 3) and the baked noise
 * (`noise-texture.ts`), each a wrapping (REPEAT), mipmapped texture the host builds itself —
 * a material's own image uniforms clamp at their edges and get no mip chain.
 *
 * The bundled detail atlas (`apps/web/public/textures/ground-detail.png`, `pnpm
 * textures:ground`) carries the four surfaces in its quadrants. Only their light and shade is
 * used (the macro rules choose the colour; the tiles' own hue made grass lime), so the four are
 * packed as the four channels of one texture — grass, rock, sand, snow in R, G, B, A — and the
 * shader takes the blend of all four in a single fetch per projection, where four separate
 * textures behind a branch cost four times the fetch sites and most of the compile time.
 *
 * Cesium's `Material` accepts a `Texture` directly for an image uniform and destroys it with the
 * material, so the caller hands the material these and forgets them when the material goes.
 */
import { GROUND_DETAIL_QUADRANTS } from '../shaders/ground.frag.ts';

/** The handful of renderer-level constructors used, typed loosely: @cesium/engine's `.d.ts` keeps them private. */
export interface DetailTileCesium {
  Texture: new (options: Record<string, unknown>) => DetailTexture;
  Sampler: new (options: Record<string, unknown>) => unknown;
  TextureWrap: { REPEAT: unknown };
  TextureMinificationFilter: { LINEAR_MIPMAP_LINEAR: unknown };
  TextureMagnificationFilter: { LINEAR: unknown };
}

export interface DetailTexture {
  destroy(): void;
  generateMipmap(): void;
}

/**
 * Per-pixel luminance of the four quadrants of `rgba` (an atlas `2 * tile` px square), packed
 * as RGBA (grass, rock, sand, snow), each tile normalised to a mean of 0.5 so a minified sample
 * tends to 0.5 and the shader's multiplier (2 × sample) to 1.
 */
export function packDetailLuminance(rgba: ArrayLike<number>, tile: number): Uint8Array {
  const width = tile * 2;
  const out = new Uint8Array(tile * tile * 4);
  for (const [q] of GROUND_DETAIL_QUADRANTS.entries()) {
    const ox = (q % 2) * tile;
    const oy = Math.floor(q / 2) * tile;
    const lum = new Float32Array(tile * tile);
    let sum = 0;
    for (let y = 0; y < tile; y++)
      for (let x = 0; x < tile; x++) {
        const i = ((oy + y) * width + ox + x) * 4;
        const l = 0.3 * (rgba[i] ?? 0) + 0.59 * (rgba[i + 1] ?? 0) + 0.11 * (rgba[i + 2] ?? 0);
        lum[y * tile + x] = l;
        sum += l;
      }
    const scale = sum > 0 ? (0.5 * 255 * lum.length) / sum : 0;
    for (let i = 0; i < lum.length; i++)
      out[i * 4 + q] = Math.max(0, Math.min(255, Math.round(lum[i]! * scale)));
  }
  return out;
}

function wrappingTexture(
  C: DetailTileCesium,
  context: unknown,
  bytes: Uint8Array,
  size: number,
): DetailTexture {
  const texture = new C.Texture({
    context,
    width: size,
    height: size,
    source: { width: size, height: size, arrayBufferView: bytes },
    sampler: new C.Sampler({
      wrapS: C.TextureWrap.REPEAT,
      wrapT: C.TextureWrap.REPEAT,
      minificationFilter: C.TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
      magnificationFilter: C.TextureMagnificationFilter.LINEAR,
      maximumAnisotropy: 4,
    }),
  });
  texture.generateMipmap();
  return texture;
}

/** The four detail tiles' luminance as one wrapping, mipmapped texture. Null when a canvas cannot be had. */
export function createDetailTexture(
  C: DetailTileCesium,
  context: unknown,
  atlas: HTMLImageElement | HTMLCanvasElement,
): DetailTexture | null {
  const tile = Math.floor(atlas.width / 2);
  if (tile < 1) return null;
  const canvas = document.createElement('canvas');
  canvas.width = tile * 2;
  canvas.height = tile * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(atlas, 0, 0, tile * 2, tile * 2, 0, 0, tile * 2, tile * 2);
  const rgba = ctx.getImageData(0, 0, tile * 2, tile * 2).data;
  return wrappingTexture(C, context, packDetailLuminance(rgba, tile), tile);
}

/** The baked noise (`makeNoiseTexture`) as a wrapping, mipmapped texture. */
export function createNoiseTexture(
  C: DetailTileCesium,
  context: unknown,
  bytes: Uint8Array,
  size: number,
): DetailTexture {
  return wrappingTexture(C, context, bytes, size);
}

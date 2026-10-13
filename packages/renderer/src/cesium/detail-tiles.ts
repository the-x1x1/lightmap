/**
 * The ground detail tiles as GPU textures (texture pack stage 3). The bundled atlas
 * (`apps/web/public/textures/ground-detail.png`, `pnpm textures:ground`) carries the four
 * surfaces in its quadrants; here it is cut into four separate textures, each wrapping (REPEAT)
 * with its own full mip chain. A material's own image uniforms clamp at their edges and would
 * share one chain across the quadrants, which bled the tiles into each other at every mip level
 * but the first — the near field went grey as the camera pulled back, then popped.
 *
 * Cesium's `Material` accepts a `Texture` directly for an image uniform and destroys it with the
 * material, so the caller hands the material these and forgets them when the material goes.
 */
import { GROUND_DETAIL_IMAGE_UNIFORMS, GROUND_DETAIL_QUADRANTS } from '../shaders/ground.frag.ts';

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
 * Cut `atlas` (2 × 2 quadrants, NW grass, NE rock, SW sand, SE snow) into four wrapping,
 * mipmapped textures keyed by their sampler uniform names. Null when a canvas cannot be had.
 */
export function createDetailTextures(
  C: DetailTileCesium,
  context: unknown,
  atlas: HTMLImageElement | HTMLCanvasElement,
): Record<string, DetailTexture> | null {
  const tile = Math.floor(atlas.width / 2);
  if (tile < 1) return null;
  const textures: Record<string, DetailTexture> = {};
  for (const [i, name] of GROUND_DETAIL_QUADRANTS.entries()) {
    const canvas = document.createElement('canvas');
    canvas.width = tile;
    canvas.height = tile;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      for (const t of Object.values(textures)) t.destroy();
      return null;
    }
    ctx.drawImage(atlas, (i % 2) * tile, Math.floor(i / 2) * tile, tile, tile, 0, 0, tile, tile);
    const texture = new C.Texture({
      context,
      source: canvas,
      // Like an image uniform's upload: the canvas's first row becomes t = 1.
      flipY: true,
      sampler: new C.Sampler({
        wrapS: C.TextureWrap.REPEAT,
        wrapT: C.TextureWrap.REPEAT,
        minificationFilter: C.TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
        magnificationFilter: C.TextureMagnificationFilter.LINEAR,
        maximumAnisotropy: 4,
      }),
    });
    texture.generateMipmap();
    textures[GROUND_DETAIL_IMAGE_UNIFORMS[name]] = texture;
  }
  return textures;
}

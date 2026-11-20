/**
 * Tile skirts that cast no shadow. Cesium hangs a wall (a skirt) under every terrain tile's
 * edges to close the cracks between tiles: neighbours at different detail levels do not share
 * their edge vertices, and even at the same level each tile quantises its own heights, so
 * without skirts single pixels of sky show through along the tile edges - dotted pale lines
 * across the ground. But a skirt is drawn into the shadow map with the rest of its tile, and
 * where it stands a little proud of the neighbouring tile's surface a low Sun drew its shadow
 * as a long black line along the tile edge (which is why the host once turned skirts off, and
 * the dotted lines came).
 *
 * This wraps Cesium's shadow-cast fragment shader factory so the globe's cast shader drops the
 * skirts: every vertex of a skirt lies on its tile's edge, so across a skirt triangle one of the
 * tile's texture coordinates is exactly 0 or 1 (GlobeVS hands the fragment shader
 * `v_textureCoordinates`, and the cast pass keeps the globe's own vertex shader), which on the
 * surface itself is true only along the edge line. Such fragments are discarded from the cast
 * pass: a strip 1e-5 of a tile wide (centimetres) goes with them, far under a shadow texel.
 * Skirts are drawn, shaded and shadowed as ever in the picture itself.
 */

/** How a cast shader's own main opens, as Cesium 1.146 writes it (every variant). */
export const CAST_MAIN_OPEN = 'void main() \n{ \n';

/** What marks the globe's fragment shader among the casters: its tile varying and a uniform of its own. */
export const GLOBE_FS_VARYING = 'in vec3 v_textureCoordinates;';
export const GLOBE_FS_UNIFORM = 'u_initialColor';

/** The discard put at the top of the globe's cast main. ASCII only. */
export const SKIRT_CAST_DISCARD_GLSL =
  CAST_MAIN_OPEN +
  '    if (min(v_textureCoordinates.x, v_textureCoordinates.y) < 1e-5 \n' +
  '        || max(v_textureCoordinates.x, v_textureCoordinates.y) > 1.0 - 1e-5) \n' +
  '    { \n' +
  '        discard; \n' +
  '    } \n';

interface ShaderSourceLike {
  defines?: string[];
  sources?: string[];
}

interface ShadowMapShaderLike {
  createShadowCastFragmentShader?: (...args: unknown[]) => ShaderSourceLike;
  __lmSkirtless?: boolean;
}

/** Whether a cast shader is the globe's (its sources carry the tile varying and the globe's uniform). */
export function isGlobeCastSource(source: ShaderSourceLike): boolean {
  const sources = source.sources;
  if (!sources || sources.length === 0) return false;
  return (
    sources.some((s) => s.includes(GLOBE_FS_VARYING)) &&
    sources.some((s) => s.includes(GLOBE_FS_UNIFORM))
  );
}

/**
 * Drop the skirts from a globe cast shader (its last source is the cast main); any other
 * caster's, or one whose main does not open as expected, is returned unchanged.
 */
export function skirtlessCastSource(source: ShaderSourceLike): ShaderSourceLike {
  const sources = source.sources;
  if (!sources || !isGlobeCastSource(source)) return source;
  const last = sources[sources.length - 1]!;
  if (!last.includes(CAST_MAIN_OPEN) || last.includes('v_textureCoordinates.x')) return source;
  sources[sources.length - 1] = last.replace(CAST_MAIN_OPEN, SKIRT_CAST_DISCARD_GLSL);
  return source;
}

/**
 * Wrap Cesium's `ShadowMapShader.createShadowCastFragmentShader` once (it is shared by every
 * scene in the page). True only when the wrap is in place and proven on a stand-in for the
 * globe's shader: the host draws skirts only then (with no factory, or a cast main this does
 * not recognise, skirts would cast their lines again, so they stay off).
 */
export function installSkirtlessShadows(C: unknown): boolean {
  const smShader = (C as { ShadowMapShader?: ShadowMapShaderLike }).ShadowMapShader;
  const original = smShader?.createShadowCastFragmentShader;
  if (!smShader || typeof original !== 'function') return false;
  if (!smShader.__lmSkirtless) {
    // Proven first on a stand-in: a globe-like source through the real factory must come back
    // with a main this recognises.
    try {
      const probe = original.call(
        smShader,
        {
          defines: [],
          sources: [`${GLOBE_FS_VARYING}\nuniform vec4 ${GLOBE_FS_UNIFORM};\nvoid main()\n{\n}\n`],
        },
        false,
        true,
        true,
        false,
      );
      const last = probe.sources?.[probe.sources.length - 1];
      if (!last || !last.includes(CAST_MAIN_OPEN) || !isGlobeCastSource(probe)) return false;
    } catch {
      return false;
    }
    smShader.createShadowCastFragmentShader = (...args: unknown[]) =>
      skirtlessCastSource(original.apply(smShader, args));
    smShader.__lmSkirtless = true;
  }
  return true;
}

/**
 * Shadows in the sky's colour. Cesium's shadow receive shader darkens what is in shade by a
 * grey (`out_FragColor.rgb *= visibility`), but shade on a clear day is lit by the blue sky
 * alone while the rest is lit by the Sun as well: shadows read cool against warm sunlight, and
 * most of all under a low, orange Sun. This wraps the shader factory so the shaded share takes
 * the sky's light relative to the scene's light (`czm_lightColor`), at its own luminance: a
 * gentle blue at noon, a strong one at golden hour, none where the shade is all but gone (an
 * overcast's darkness near 1 leaves nothing to tint) and none outside the shadow.
 */

/** The receive shader's last line, as Cesium 1.146 writes it. */
export const SHADOW_APPLY_LINE = 'out_FragColor.rgb *= visibility;';

/**
 * What replaces it: the shaded fraction `s` (how far the visibility has gone toward the
 * darkness), and the shade tinted by the sky over the light by up to 60 % of it. The sky's own
 * colour (0.80, 0.90, 1.05) is a clear day's blue at the renderer's white; divided by the light's
 * colour and brought back to unit luminance. ASCII only.
 */
export const SHADOW_TINT_GLSL = `{
        float lmDark = shadowMap_normalOffsetScaleDistanceMaxDistanceAndDarkness.w;
        float lmShade = clamp((1.0 - visibility) / max(1.0 - lmDark, 1e-3), 0.0, 1.0);
        vec3 lmTint = vec3(0.80, 0.90, 1.05) / max(czm_lightColor, vec3(0.05));
        lmTint /= max(dot(lmTint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
        out_FragColor.rgb *= visibility * mix(vec3(1.0), lmTint, 0.6 * lmShade);
    }`;

interface ShaderSourceLike {
  sources?: string[];
}

interface ShadowMapShaderLike {
  createShadowReceiveFragmentShader?: (...args: unknown[]) => ShaderSourceLike;
  __lmTinted?: boolean;
}

/** Tint the last source of a receive shader; unchanged when the line is not there. */
export function tintShadowSource(source: ShaderSourceLike): ShaderSourceLike {
  const sources = source.sources;
  if (!sources || sources.length === 0) return source;
  const last = sources[sources.length - 1]!;
  if (!last.includes(SHADOW_APPLY_LINE)) return source;
  sources[sources.length - 1] = last.replace(SHADOW_APPLY_LINE, SHADOW_TINT_GLSL);
  return source;
}

/**
 * Wrap Cesium's `ShadowMapShader.createShadowReceiveFragmentShader` once (it is shared by every
 * scene in the page). False when this Cesium has no such factory (shadows stay grey).
 */
export function installShadowTint(C: unknown): boolean {
  const smShader = (C as { ShadowMapShader?: ShadowMapShaderLike }).ShadowMapShader;
  const original = smShader?.createShadowReceiveFragmentShader;
  if (!smShader || typeof original !== 'function') return false;
  if (smShader.__lmTinted) return true;
  smShader.createShadowReceiveFragmentShader = (...args: unknown[]) =>
    tintShadowSource(original.apply(smShader, args));
  smShader.__lmTinted = true;
  return true;
}

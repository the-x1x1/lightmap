/**
 * The terrain's water mask, smoothed before anything reads it.
 *
 * Cesium's terrain carries a 256-texel water mask per tile, and finer tiles reuse a coarser
 * ancestor's mask magnified: one texel of it is 50–500 m of ground, and the coast it draws is
 * a staircase of bilinear-blurred squares — on every coast, at every close zoom. Both the
 * globe's own ocean shading and the ground material read it at one point.
 *
 * Here the globe's fragment shader reads it through a small blur (a centre tap and two rings,
 * 0.75 and 1.5 texels out, of the mask's own texture) and sharpens the result again around ½:
 * the edge stays where the mask had it on a straight coast and corners round off into curves,
 * so the staircase becomes a coastline. Water narrower than about a texel (a stream the mask
 * barely has) thins rather than vanishing, since the sharpening keeps a soft low tail.
 *
 * The patch edits Cesium's GlobeFS source in the surface shader set (an internal), keyed on the
 * one line that samples the mask; when that line is not found (a Cesium upgrade changed it),
 * nothing is patched and the plain mask is used.
 */

/** The line in Cesium's GlobeFS (1.12x / @cesium/engine 2x) that reads the mask. */
export const GLOBE_MASK_SAMPLE_LINE =
  'float mask = texture(u_waterMask, waterMaskTextureCoordinates).r;';

/** GLSL inserted before GlobeFS's `void main()`: the smoothed read. */
export const SMOOTH_WATER_MASK_GLSL = /* glsl */ `
#if defined(HAS_WATER_MASK) && (defined(SHOW_REFLECTIVE_OCEAN) || defined(APPLY_MATERIAL))
float lmSmoothWaterMask(vec2 uv)
{
#if __VERSION__ >= 300
    vec2 size = vec2(textureSize(u_waterMask, 0));
    // An all-land or all-water tile carries a 1 x 1 mask: nothing to smooth.
    if (size.x < 2.0) return texture(u_waterMask, uv).r;
    vec2 t = 1.0 / size;
    float s = 4.0 * texture(u_waterMask, uv).r;
    for (int i = 0; i < 8; i++)
    {
        float a = float(i) * 0.785398;
        vec2 d = vec2(cos(a), sin(a));
        s += 2.0 * texture(u_waterMask, uv + d * 0.75 * t).r;
        s += texture(u_waterMask, uv + vec2(cos(a + 0.392699), sin(a + 0.392699)) * 1.5 * t).r;
    }
    float b = s / 28.0;
    // Sharpen around the half-way level (where the coast was) and keep a soft tail below it.
    return max(smoothstep(0.38, 0.62, b), 0.45 * smoothstep(0.08, 0.38, b) * smoothstep(0.62, 0.38, b));
#else
    return texture(u_waterMask, uv).r;
#endif
}
#endif
`;

/**
 * GlobeFS with the smoothed read, or null when its mask line or `void main()` is not there
 * exactly once (then the caller leaves it alone).
 */
export function patchGlobeFragmentSource(src: string): string | null {
  if (src.includes('lmSmoothWaterMask')) return src;
  const line = src.split(GLOBE_MASK_SAMPLE_LINE);
  const main = src.split('void main()');
  if (line.length !== 2 || main.length !== 2) return null;
  return src
    .replace('void main()', `${SMOOTH_WATER_MASK_GLSL}\nvoid main()`)
    .replace(
      GLOBE_MASK_SAMPLE_LINE,
      'float mask = lmSmoothWaterMask(waterMaskTextureCoordinates);',
    );
}

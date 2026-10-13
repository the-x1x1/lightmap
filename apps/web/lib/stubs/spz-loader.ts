/**
 * Stand-in for `@spz-loader/core` (next.config.ts aliases it here).
 *
 * @cesium/engine imports that package for the `KHR_gaussian_splatting_compression_spz_2` glTF
 * extension — Gaussian splat tilesets, which LightMap does not render. The real module inlines
 * its WebAssembly as a binary string, and Next's production minifier rewrites that string into a
 * template literal containing `\00`, an octal escape that is a syntax error in templates: the
 * browser refused the whole Cesium chunk ("Loading chunk 8530 failed") and the globe never
 * appeared in a production build. Dev mode does not minify, which is why it only showed there.
 */
export async function loadSpz(): Promise<never> {
  throw new Error('Gaussian splat (SPZ) content is not supported in LightMap');
}

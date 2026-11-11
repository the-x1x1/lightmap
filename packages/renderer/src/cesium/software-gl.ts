/**
 * Whether the WebGL context runs on a software renderer: SwiftShader (headless Chromium, CI's
 * browsers, Chrome with no usable GPU), Mesa's llvmpipe or softpipe, Microsoft's Basic Render
 * Driver or WARP. Every pixel there is shaded on the CPU, so the host draws fewer of them.
 */
export function isSoftwareRendererName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /swiftshader|llvmpipe|softpipe|software|basic render driver|\bwarp\b/i.test(name);
}

interface RendererGl {
  readonly RENDERER: number;
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
}

/** The renderer's name, unmasked where the browser allows it; null with no context. */
export function rendererName(gl: unknown): string | null {
  const g = gl as RendererGl | null | undefined;
  if (!g || typeof g.getParameter !== 'function') return null;
  try {
    const ext = g.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const unmasked = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    const name = typeof unmasked === 'string' && unmasked ? unmasked : g.getParameter(g.RENDERER);
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

import { describe, expect, it } from 'vitest';
import { isSoftwareRendererName, rendererName } from '../src/cesium/software-gl.ts';

describe('software renderers', () => {
  it('knows the software renderers by name', () => {
    for (const name of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'Google SwiftShader',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ])
      expect(isSoftwareRendererName(name)).toBe(true);
  });

  it('leaves real GPUs and an unknown name alone', () => {
    for (const name of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple M2',
      'Mali-G710',
      'WebKit WebGL',
      '',
      null,
    ])
      expect(isSoftwareRendererName(name)).toBe(false);
  });

  it('reads the unmasked name, else the plain one, and nothing from no context', () => {
    const gl = (unmasked: string | null) => ({
      RENDERER: 1,
      getExtension: (n: string) =>
        n === 'WEBGL_debug_renderer_info' && unmasked !== null
          ? { UNMASKED_RENDERER_WEBGL: 2 }
          : null,
      getParameter: (p: number) => (p === 2 ? unmasked : 'WebKit WebGL'),
    });
    expect(rendererName(gl('Google SwiftShader'))).toBe('Google SwiftShader');
    expect(rendererName(gl(null))).toBe('WebKit WebGL');
    expect(rendererName(undefined)).toBeNull();
  });
});

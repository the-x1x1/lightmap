import { describe, expect, it } from 'vitest';
import {
  CAST_MAIN_OPEN,
  GLOBE_FS_UNIFORM,
  GLOBE_FS_VARYING,
  SKIRT_CAST_DISCARD_GLSL,
  installSkirtlessShadows,
  isGlobeCastSource,
  skirtlessCastSource,
} from '../src/cesium/skirt-shadows.ts';

/** Cesium 1.146's cast fragment shader factory, in short: the mains renamed, a new one pushed. */
function castFactory(fs: { defines: string[]; sources: string[] }) {
  const sources = fs.sources.map((s) => s.replace(/void\s+main\s*\(\s*\)/g, 'void czm_cast()'));
  sources.push(`${CAST_MAIN_OPEN}    out_FragColor = vec4(1.0); \n} \n`);
  return { defines: [...fs.defines, 'SHADOW_MAP'], sources };
}
const globeFs = () => ({
  defines: [],
  sources: [
    `uniform vec4 ${GLOBE_FS_UNIFORM};\n${GLOBE_FS_VARYING}\nvoid main()\n{\n}\n`,
    'float helper() { return 1.0; }',
  ],
});
const modelFs = () => ({
  defines: [],
  sources: ['in vec2 v_st;\nvoid main()\n{\n    out_FragColor = vec4(v_st, 0.0, 1.0);\n}\n'],
});

describe('skirts that cast no shadow', () => {
  it("drops a tile's edge from the globe's cast shader, once, and from no other caster's", () => {
    const globe = castFactory(globeFs());
    expect(isGlobeCastSource(globe)).toBe(true);
    skirtlessCastSource(globe);
    const main = globe.sources[globe.sources.length - 1]!;
    expect(main.startsWith(SKIRT_CAST_DISCARD_GLSL)).toBe(true);
    expect(main).toContain('discard;');
    expect(main).toContain('out_FragColor = vec4(1.0);');
    // The globe's own sources are untouched.
    expect(globe.sources[0]).not.toContain('discard');
    // Applying twice changes nothing.
    const once = main;
    skirtlessCastSource(globe);
    expect(globe.sources[globe.sources.length - 1]).toBe(once);
    // A building's or a tree's cast shader is not the globe's.
    const model = castFactory(modelFs());
    expect(isGlobeCastSource(model)).toBe(false);
    skirtlessCastSource(model);
    expect(model.sources.join('\n')).not.toContain('discard');
  });

  it('wraps the factory once, proven on a stand-in; skirts stay off where it cannot be', () => {
    let calls = 0;
    const C = {
      ShadowMapShader: {
        createShadowCastFragmentShader: (fs: { defines: string[]; sources: string[] }) => {
          calls++;
          return castFactory(fs);
        },
      },
    };
    expect(installSkirtlessShadows(C)).toBe(true);
    expect(installSkirtlessShadows(C)).toBe(true);
    expect(calls).toBe(1); // the stand-in, once
    const out = C.ShadowMapShader.createShadowCastFragmentShader(globeFs());
    expect(out.sources[out.sources.length - 1]).toContain('v_textureCoordinates.x');
    const other = C.ShadowMapShader.createShadowCastFragmentShader(modelFs());
    expect(other.sources.join('\n')).not.toContain('discard');
    // No factory: no skirts.
    expect(installSkirtlessShadows({})).toBe(false);
    // A factory whose main opens some other way (a later Cesium): not wrapped, no skirts.
    const changed = {
      ShadowMapShader: {
        createShadowCastFragmentShader: (fs: { defines: string[]; sources: string[] }) => ({
          defines: fs.defines,
          sources: [...fs.sources, 'void main(void) { out_FragColor = vec4(1.0); }'],
        }),
      },
    };
    const before = changed.ShadowMapShader.createShadowCastFragmentShader;
    expect(installSkirtlessShadows(changed)).toBe(false);
    expect(changed.ShadowMapShader.createShadowCastFragmentShader).toBe(before);
    // One that throws on the stand-in: the same.
    const broken = {
      ShadowMapShader: {
        createShadowCastFragmentShader: () => {
          throw new Error('no');
        },
      },
    };
    expect(installSkirtlessShadows(broken)).toBe(false);
  });

  it('is ASCII', () => {
    expect([...SKIRT_CAST_DISCARD_GLSL].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});

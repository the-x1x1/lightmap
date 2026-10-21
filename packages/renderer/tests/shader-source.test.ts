import { describe, expect, it } from 'vitest';
import {
  GRADE_DAY_FRAGMENT_SHADER,
  GRADE_FRAGMENT_SHADER,
  GRADE_UNIFORM_NAMES,
} from '../src/shaders/grade.frag.ts';
import { GROUND_MATERIAL_SOURCE } from '../src/shaders/ground.frag.ts';
import { LIT_INSTANCE_FS, treeFragmentShader } from '../src/cesium/osm-buildings-layer.ts';

/**
 * GLSL ES allows only ASCII, comments included; a stray "≈" or em dash from prose-style
 * comments is invalid source to a strict compiler.
 */
describe('shader sources', () => {
  for (const [name, src] of [
    ['ground material', GROUND_MATERIAL_SOURCE],
    ['grade', GRADE_FRAGMENT_SHADER],
  ] as const) {
    it(`${name} is plain ASCII`, () => {
      const bad = [...src].filter((c) => c.charCodeAt(0) > 127);
      expect(bad).toEqual([]);
    });
  }
});

describe('the grade shader and its uniform list', () => {
  it('declares exactly the uniforms GRADE_UNIFORM_NAMES lists (besides the stage textures)', () => {
    const declared = [...GRADE_FRAGMENT_SHADER.matchAll(/^uniform\s+\w+\s+(\w+)\s*;/gm)]
      .map((m) => m[1])
      .filter((n) => n !== 'colorTexture' && n !== 'depthTexture');
    expect([...declared].sort()).toEqual([...GRADE_UNIFORM_NAMES].sort());
  });
});

describe('the day grade', () => {
  it('is the night grade without LM_NIGHT, and drops every night-sky part', () => {
    expect(GRADE_FRAGMENT_SHADER).toBe(`#define LM_NIGHT\n${GRADE_DAY_FRAGMENT_SHADER}`);
    expect(GRADE_DAY_FRAGMENT_SHADER).not.toMatch(/^#define LM_NIGHT/m);
    // Each night part sits inside an LM_NIGHT block: the planets, the stars' light and the
    // Moon's aureole.
    const blocks = [...GRADE_DAY_FRAGMENT_SHADER.matchAll(/#ifdef LM_NIGHT([\s\S]*?)#endif/g)]
      .map((m) => m[1])
      .join('\n');
    expect(blocks).toContain('planetLight(u_planet0');
    expect(blocks).toContain('ringMax(uv');
    expect(blocks).toContain('starLight * starFade');
    expect(blocks).toContain('u_moonGlow * (near + wide)');
  });
});

describe("shader sources and Cesium's preprocessor", () => {
  // Cesium's ShaderSource strips a /** ... */ comment by counting the newlines in it
  // (match(/\n/gm).length) and throws on one without any: a one-line doc comment in GLSL stops
  // the program from building and the renderer with it (seen in tools/renderer-smoke).
  for (const [name, src] of [
    ['ground material', GROUND_MATERIAL_SOURCE],
    ['grade', GRADE_FRAGMENT_SHADER],
    ['day grade', GRADE_DAY_FRAGMENT_SHADER],
    ['lit instances', LIT_INSTANCE_FS],
    ['trees', treeFragmentShader(0.5, 0.5, 0.5, 1000, 0.5)],
  ] as const) {
    it(`${name} has no one-line /** */ comment`, () => {
      const oneLine = [...src.matchAll(/\/\*\*[\s\S]*?\*\//g)]
        .map((m) => m[0])
        .filter((c) => !c.includes('\n'));
      expect(oneLine).toEqual([]);
    });
  }
});

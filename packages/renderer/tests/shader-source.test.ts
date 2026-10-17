import { describe, expect, it } from 'vitest';
import { GRADE_FRAGMENT_SHADER, GRADE_UNIFORM_NAMES } from '../src/shaders/grade.frag.ts';
import { GROUND_MATERIAL_SOURCE } from '../src/shaders/ground.frag.ts';

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

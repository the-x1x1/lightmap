import { describe, expect, it } from 'vitest';
import { GRADE_FRAGMENT_SHADER } from '../src/shaders/grade.frag.ts';
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

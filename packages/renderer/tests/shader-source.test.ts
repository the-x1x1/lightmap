import { describe, expect, it } from 'vitest';
import { GRADE_FRAGMENT_SHADER } from '../src/shaders/grade.frag.ts';
import { GROUND_MATERIAL_SOURCE } from '../src/shaders/ground.frag.ts';

/**
 * GLSL ES allows only ASCII, comments included. A "≈" or an em dash in a comment compiled on
 * most drivers, but through ANGLE's Direct3D translation (Chrome and Edge on Windows) it
 * silently dropped part of the ground material — the town blocks vanished while every other
 * rule still drew.
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

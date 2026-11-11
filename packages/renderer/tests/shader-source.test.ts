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

describe('the grade', () => {
  it('hazes toward the horizon sky on both sides, darkening it with the night', () => {
    for (const src of [GRADE_FRAGMENT_SHADER, GRADE_DAY_FRAGMENT_SHADER]) {
      expect(src).toContain('vec3 hazeCol = mix(u_hazeAway, u_hazeToward, glowSide);');
      expect(src).toContain('hazeCol = mix(hazeCol, vec3(0.012, 0.016, 0.03), u_nightFactor);');
    }
    expect(GRADE_UNIFORM_NAMES).toContain('u_hazeAway');
    expect(GRADE_UNIFORM_NAMES).toContain('u_hazeBaseM');
    expect(GRADE_UNIFORM_NAMES).toContain('u_hazeToward');
  });

  it('thins the haze with height above the place, averaged along the ray', () => {
    // The layer: exp(-h / 1200) from the place's ground, averaged between the eye's height and
    // the point's, held to 2.5 times the place's own density.
    for (const src of [GRADE_FRAGMENT_SHADER, GRADE_DAY_FRAGMENT_SHADER]) {
      expect(src).toContain('float h0 = max(u_eyeHeightM - u_hazeBaseM, -1100.0);');
      expect(src).toContain('1200.0 * (exp(-h1 / 1200.0) - rho0) / (h0 - h1)');
      expect(src).toContain('layer = min(layer, 2.5);');
    }
    // What the layer gives, in numbers (the shader's formula, here in TypeScript).
    const layer = (h0: number, h1: number) => {
      const rho0 = Math.exp(-h0 / 1200);
      const v = Math.abs(h0 - h1) < 1 ? rho0 : (1200 * (Math.exp(-h1 / 1200) - rho0)) / (h0 - h1);
      return Math.min(v, 2.5);
    };
    expect(layer(2, 2)).toBeCloseTo(1, 2); // at the place's ground: its own visibility
    expect(layer(3000, 3000)).toBeLessThan(0.1); // a summit's horizontal view: thin air
    expect(layer(3000, 0)).toBeGreaterThan(0.3); // down into the valley: through the haze
    expect(layer(2, 800)).toBeGreaterThan(0.7); // up at a ridge from the beach: a little clearer
    expect(layer(2, 800)).toBeLessThan(0.8);
    expect(layer(0, -1000)).toBeLessThan(2.5); // a gorge below the place: hazier, held
    // From orbit, straight down: thin (an eye clamped at 20 km had averaged the haze over 21 km
    // and spread it over the whole path, washing whole-Earth views out).
    expect(layer(300_000, 0) * 300_000).toBeLessThan(1200 * 1.01);
    expect(layer(50_000, 0) * 50_000).toBeLessThan(1200 * 1.01);
  });

  it('gives a closing low deck the CIE overcast profile, brightest overhead', () => {
    expect(GRADE_DAY_FRAGMENT_SHADER).toContain(
      'float cie = clamp((1.0 + 2.0 * sinView) / 1.52, 0.65, 1.45);',
    );
    expect(GRADE_DAY_FRAGMENT_SHADER).toContain(
      'cloudCol *= mix(1.0, cie, smoothstep(0.6, 0.95, covLow));',
    );
  });
});

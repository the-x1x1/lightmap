import { describe, expect, it } from 'vitest';
import {
  FACADE_ALPHA,
  LIT_INSTANCE_FS,
  PRIMITIVE_NORMAL_SHADING_SMOOTH,
  facadeKind,
  litInstanceShader,
  treeFragmentShader,
} from '../src/cesium/osm-buildings-layer.ts';

describe('buildings and trees shader', () => {
  it('is plain ASCII in every variant', () => {
    for (const src of [
      LIT_INSTANCE_FS,
      litInstanceShader(0.2, 8000),
      treeFragmentShader(0.3, 0.7, 0.45, 20000),
    ]) {
      expect([...src].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
    }
  });

  it('divides out the shadow map darkness only within its distance', () => {
    const src = litInstanceShader(0.2, 8000);
    expect(src).toContain(`/ ${PRIMITIVE_NORMAL_SHADING_SMOOTH.toFixed(3)}, 0.0, 1.0), 0.200)`);
    expect(src).toContain('if (-v_positionEC.z < 8000.0) outRgb /= expected;');
  });

  it('takes the direction of the light from the direct share, keeping the level of a roof', () => {
    // A clear day: the Sun's whole term is directional, nothing moved to the sky.
    const clear = litInstanceShader(0.2, 8000, true, 1);
    expect(clear).toContain('0.55 * 1.00 * sun');
    expect(clear).toContain('0.55 * (1.0 - 1.00)');
    // An overcast: a fifth of it directional; the rest from the sky, by how much a face looks
    // up (a flat roof, sky = 1 and sun = sunUp, gets exactly its 0.55 * sunUp back), and the
    // ground's bounce under the faces that look down is left as it was.
    const overcast = litInstanceShader(0.2, 8000, true, 0.2);
    expect(overcast).toContain('0.55 * 0.20 * sun');
    expect(overcast).toContain(
      'float diffuseSun = 0.55 * (1.0 - 0.20) * sunUp * (0.5 + 0.5 * sky);',
    );
    expect(overcast).toContain('float bounce = 0.12 * (1.0 - sky) * sunUp;');
    // The trees take the same, the default (no share given) is a clear day's.
    expect(treeFragmentShader(1, 0, 1, 0, 1, 0.3)).toContain('0.55 * 0.30 * sun');
    expect(LIT_INSTANCE_FS).toContain('0.55 * 1.00 * sun');
    // In twilight the sky terms rise with the ground's (globeLightSplit's skyLift), held to 3.4.
    expect(LIT_INSTANCE_FS).toContain('(0.16 + 0.14 * sky) * 1.00');
    expect(litInstanceShader(1, 0, true, 0.2, 3.33)).toContain('(0.16 + 0.14 * sky) * 3.33');
    expect(treeFragmentShader(1, 0, 1, 0, 1, 0.2, 9)).toContain('(0.16 + 0.14 * sky) * 3.40');
  });

  it('compensates nothing with shadows off', () => {
    // Darkness 1 makes the expected factor 1, and a zero distance skips the division.
    expect(LIT_INSTANCE_FS).toContain('0.0, 1.0), 1.000)');
    expect(LIT_INSTANCE_FS).toContain('if (-v_positionEC.z < 0.0)');
  });

  it('keeps the leaf season in the trees and floors a black shadow', () => {
    const tree = treeFragmentShader(0.5, 0.5, 0, 100);
    expect(tree).toContain('v_color.a < 0.995');
    expect(tree).toContain('0.050)');
  });

  it('gives the season to the deciduous share of crowns only', () => {
    expect(treeFragmentShader(0.5, 0.5)).not.toContain('11.1');
    expect(treeFragmentShader(0, 0, 1, 0, 0.35)).toContain(
      'if (v_color.a < 0.995 && fract(h * 11.1) < 0.350)',
    );
  });

  it('darkens roofs on buildings only', () => {
    expect(litInstanceShader(0.2, 8000, true)).toContain('roofness');
    expect(litInstanceShader(0.2, 8000)).not.toContain('roofness');
    expect(treeFragmentShader(1, 0, 0.2, 8000)).not.toContain('roofness');
  });

  it('gives the buildings glass windows by day and lights them from the dusk only, in ASCII', () => {
    // By day: the grid and its glass, no lamps.
    const day = litInstanceShader(0.2, 8000, true, 1, 1, 0);
    expect(day).toContain('wallness');
    expect(day).toContain('outRgb = mix(outRgb, pane, glass * wallness);');
    expect(day).not.toContain('litW');
    expect([...day].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    // The glass takes the sky's light with the sky terms' own lift.
    expect(litInstanceShader(0.2, 8000, true, 0, 3, 0)).toContain('(0.4 + 0.6 * sky) * 3.00');
    const night = litInstanceShader(0.2, 8000, true, 0, 3, 1);
    expect(night).toContain('wallness');
    expect(night).toContain('glass * wallness');
    expect(night).toContain('0.38 * 1.00');
    expect([...night].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    // Trees and the roof-less test block take none.
    expect(litInstanceShader(0.2, 8000, false, 0, 3, 1)).not.toContain('wallness');
    expect(litInstanceShader(0.2, 8000, false, 1, 1, 0)).not.toContain('wallness');
  });

  it('glazes a building by the mark in its alpha: punched windows, ribbons or a curtain wall', () => {
    const day = litInstanceShader(0.2, 8000, true, 1, 1, 0);
    // The marks are read between their steps, and the buildings are drawn opaque.
    expect(day).toContain('float ribbon = step(v_color.a, 0.99);');
    expect(day).toContain('float curtain = step(v_color.a, 0.97);');
    expect(day.indexOf('color.a = 1.0;')).toBeLessThan(day.indexOf('out_FragColor'));
    // A colour attribute is a byte: each mark must land on its own side of the steps.
    const byte = (a: number) => (a === 1 ? 255 : Math.floor(a * 256)) / 255;
    expect(byte(FACADE_ALPHA.punched)).toBeGreaterThan(0.99);
    expect(byte(FACADE_ALPHA.ribbon)).toBeLessThan(0.99);
    expect(byte(FACADE_ALPHA.ribbon)).toBeGreaterThan(0.97);
    expect(byte(FACADE_ALPHA.curtain)).toBeLessThan(0.97);
    // The wall's share of glass: a fifth punched, about two fifths in ribbons, three quarters
    // as a curtain wall - and a far wall and a far town's lamps both take that share.
    expect((0.7 - 0.3) * (0.8 - 0.3)).toBeCloseTo(0.2, 9);
    expect((0.97 - 0.03) * (0.8 - 0.34)).toBeCloseTo(0.43, 2);
    expect((0.96 - 0.04) * (0.91 - 0.09)).toBeCloseTo(0.75, 2);
    expect(day).toContain('float glass = mix(inX * inY, share, far);');
    expect(litInstanceShader(0.2, 8000, true, 0, 3, 1)).toContain('* 0.38 * 1.00 * share;');
    // Every pane alike once the grid is past telling (no shimmer on a far glass tower).
    expect(day).toContain('mix(fract(hsh * 5.9), 0.5, far)');
    // The trees' alpha is theirs (the broad-leaf mark): no glazing is read from it.
    expect(treeFragmentShader(1, 0, 0.45, 20000)).not.toContain('curtain');
  });

  it('picks the glazing by height: towers by their material, some mid-rise in ribbons', () => {
    // Towers, in the order of their materials: blue glass, steel and glass, concrete, dark glass.
    expect(facadeKind(80, 0.1)).toBe('curtain');
    expect(facadeKind(80, 0.3)).toBe('ribbon');
    expect(facadeKind(80, 0.6)).toBe('punched');
    expect(facadeKind(80, 0.9)).toBe('curtain');
    expect(facadeKind(80, 1)).toBe('curtain');
    // Houses: always punched.
    for (let i = 0; i < 100; i++) expect(facadeKind(9, i / 100)).toBe('punched');
    // Mid-rise: about a quarter in ribbons, none curtain-walled.
    let ribbons = 0;
    for (let i = 0; i < 1000; i++) {
      const k = facadeKind(20, (i + 0.5) / 1000);
      expect(k).not.toBe('curtain');
      if (k === 'ribbon') ribbons++;
    }
    expect(ribbons).toBeGreaterThan(220);
    expect(ribbons).toBeLessThan(280);
    expect(facadeKind(35, 0.1)).not.toBe('curtain');
    expect(facadeKind(Number.NaN, 0.1)).toBe('punched');
  });

  it("numbers a building's windows by its colour's bytes, so a window is lit all over", () => {
    // A wall's colour is one value at every vertex, yet interpolated it can differ in its last
    // bit from pixel to pixel; the windows' hash multiplies that by tens of thousands. The
    // bytes are exact (the attribute is one), and their weights are the old ones over 255.
    const night = litInstanceShader(0.2, 8000, true, 0, 3, 1);
    expect(night).toContain('vec2 own = floor(v_color.rb * 255.0 + 0.5);');
    expect(night).toContain('dot(own, vec2(0.3596, 0.1463))');
    expect(night).not.toMatch(/sin\([^;]*v_color/);
    expect(0.3596 * 255).toBeCloseTo(91.7, 1);
    expect(0.1463 * 255).toBeCloseTo(37.3, 1);
  });

  it('lying snow whitens what looks up - roofs fully, crowns in patches - and nothing without it', () => {
    const roofs = litInstanceShader(0.2, 8000, true, 1, 1, 0, 0.8);
    expect(roofs).toContain('float snowUp = smoothstep(0.35, 0.8, dot(normalEC, upEC));');
    expect(roofs).toContain('0.80 * snowUp');
    expect(treeFragmentShader(1, 0, 0.45, 20000, 1, 1, 1, 1)).toContain('0.55 * snowUp');
    expect(litInstanceShader(0.2, 8000, true)).not.toContain('snowUp');
    expect(treeFragmentShader(1, 0)).not.toContain('snowUp');
    expect([...roofs].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it('crowns are foliage - clumps in relief, a lobed outline - and buildings are not', () => {
    const tree = treeFragmentShader(1, 0, 0.45, 20000);
    // The noise is defined once, before main, and read in it.
    expect(tree.indexOf('float lmLeafNoise(vec3 p, float n)')).toBeGreaterThan(0);
    expect(tree.indexOf('float lmLeafNoise(vec3 p, float n)')).toBeLessThan(
      tree.indexOf('void main()'),
    );
    expect(tree.split('void main()').length).toBe(2);
    expect(tree.indexOf('leafTex')).toBeGreaterThan(tree.indexOf('void main()'));
    // Crowns only (a trunk's bark is redder than it is green), with an outline that is cut:
    // never where the crown faces the eye, always at its very limb.
    expect(tree.split('if (v_color.g > v_color.r + 0.01) {').length).toBe(3);
    expect(tree).toContain(
      'float leafCut = clamp(0.42 - 0.9 * clumpTex - 0.3 * fineTex, 0.24, 0.8);',
    );
    const cut = 'if (leafFacing < leafCut) discard;';
    expect(tree).toContain(cut);
    expect(tree).toContain('float leafFacing = dot(normalEC, normalize(-v_positionEC));');
    expect(Math.sqrt(1 - 0.8 ** 2)).toBeCloseTo(0.6, 6);
    expect(Math.sqrt(1 - 0.24 ** 2)).toBeGreaterThan(0.97);
    // The relief turns the normal the lighting reads (not the one the shadow is biased by),
    // before the Sun's and the sky's terms are taken from it.
    const bump = tree.indexOf('if (leafN2 > 0.0) normalEC = leafN * inversesqrt(leafN2);');
    expect(bump).toBeGreaterThan(0);
    expect(bump).toBeLessThan(tree.indexOf('float sun = max(dot(normalEC'));
    expect(tree).not.toMatch(/shadeNormalEC = leafN/);
    // Every derivative is read before a fragment can be discarded - the outline's cut and the
    // bare crown's dither both - so no neighbour differences against a fragment that stopped.
    const firstDiscard = tree.indexOf('discard;');
    expect(firstDiscard).toBe(tree.indexOf(cut) + cut.length - 'discard;'.length);
    expect(tree.lastIndexOf('dFdx(')).toBeLessThan(firstDiscard);
    expect(tree.lastIndexOf('dFdy(')).toBeLessThan(firstDiscard);
    // The tone comes after the season has coloured the crown, so autumn keeps its mottle.
    expect(tree.indexOf('color.rgb *= (0.70 + 0.60 * leafTex) * leafShade;')).toBeGreaterThan(
      tree.indexOf('float turn = '),
    );
    // Fixed to the ground: the camera's own low part, wrapped where its high part steps.
    expect(tree).toContain('mod(czm_encodedCameraPositionMCLow + leafRel, 51.2)');
    expect(65536 / 51.2).toBe(1280);
    expect(LIT_INSTANCE_FS).not.toContain('leafTex');
    expect(litInstanceShader(0.2, 8000, true)).not.toContain('lmLeafNoise');
  });

  it('a conifer carries its boughs in tiers: a saw-edged cone, banded, and no eaten side', () => {
    const tree = treeFragmentShader(1, 0, 0.45, 20000);
    // Conifers are the crowns without the broad-leaf mark in their alpha.
    const at = tree.indexOf('if (v_color.a > 0.995) {');
    expect(at).toBeGreaterThan(tree.indexOf('float leafCut = '));
    expect(at).toBeLessThan(tree.indexOf('if (leafFacing < leafCut) discard;'));
    // Tiers 1.3 m apart by height above the ellipsoid, swayed by the clumps.
    expect(tree).toContain(
      'float tier = fract((czm_eyeHeight + dot(v_positionEC, leafUpEC)) / 1.3 + 0.9 * clumpTex);',
    );
    // The cone keeps to its edge: with no noise the cut lies between 0.03 and 0.41 of facing
    // across a tier (a round crown's starts at 0.42), and never below 0.10.
    const cutAt = (tier: number) => 0.16 + 0.38 * (tier - 0.35);
    expect(cutAt(0)).toBeCloseTo(0.027, 3);
    expect(cutAt(1)).toBeCloseTo(0.407, 3);
    expect(tree).toContain('- 0.5 * clumpTex - 0.3 * fineTex, 0.10, 0.8);');
    // The tiers' shade keeps the cone's mean brightness: +12 % at the foot, less the shade
    // toward the top (the mean of smoothstep(0.45, 1, t) over a tier is 0.275).
    let mean = 0;
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    for (let i = 0; i < 1000; i++) mean += (0.12 - 0.45 * smooth(0.45, 1, (i + 0.5) / 1000)) / 1000;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    // Past telling (a pixel over half a tier) the tiers are gone.
    expect(tree).toContain('float tierSeen = 1.0 - smoothstep(0.26, 0.59, leafPx);');
    expect(0.59 / 1.3).toBeLessThan(0.5);
  });

  it('rain-wet walls, roofs and leaves darken by up to a quarter', () => {
    expect(litInstanceShader(0.2, 8000, true, 1, 1, 0, 0, 1)).toContain('color.rgb *= 0.750;');
    expect(treeFragmentShader(1, 0, 0.45, 20000, 1, 1, 1, 0, 0.4)).toContain('color.rgb *= 0.900;');
    expect(litInstanceShader(0.2, 8000, true)).not.toContain('color.rgb *= 0.');
  });
});

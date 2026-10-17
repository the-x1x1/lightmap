import { describe, expect, it } from 'vitest';
import { SUMMER, seasonKey, seasonShows, seasonalisePixels } from '../src/imagery-season.ts';

const px = (...rgb: [number, number, number][]) =>
  new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));
const at = (d: Uint8ClampedArray, i: number) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];

const WOOD: [number, number, number] = [38, 66, 34];
const FIELD: [number, number, number] = [118, 150, 72];
const WATER: [number, number, number] = [28, 58, 92];
const TOWN: [number, number, number] = [132, 130, 126];

describe('the season on the far imagery (V&V: Vermont in October stayed green)', () => {
  it('leaves summer alone', () => {
    const d = px(WOOD, FIELD, WATER, TOWN);
    const before = Array.from(d);
    seasonalisePixels(d, 4, SUMMER);
    expect(Array.from(d)).toEqual(before);
    expect(seasonShows(SUMMER)).toBe(false);
  });

  it('turns the woods in autumn, and only the woods', () => {
    const d = px(WOOD, FIELD, WATER, TOWN);
    seasonalisePixels(d, 4, { leafOn: 1, autumn: 1, grassGreen: 1, snow: 0 });
    const [r, g] = at(d, 0) as [number, number, number];
    expect(r).toBeGreaterThan(g); // no longer green
    expect(at(d, 2)).toEqual(WATER);
    expect(at(d, 3)).toEqual(TOWN);
  });

  it('bares the woods and browns the grass in winter, and snow whitens open ground', () => {
    const d = px(WOOD, FIELD, WATER);
    seasonalisePixels(d, 3, { leafOn: 0, autumn: 1, grassGreen: 0.35, snow: 0 });
    const [wr, wg] = at(d, 0) as [number, number, number];
    expect(Math.abs(wr - wg)).toBeLessThan(15); // grey-brown, not green
    const [fr, fg] = at(d, 1) as [number, number, number];
    expect(fg - fr).toBeLessThan(FIELD[1] - FIELD[0]); // tan-ward
    const s = px(FIELD, WOOD, WATER);
    seasonalisePixels(s, 3, { leafOn: 0, autumn: 1, grassGreen: 0.35, snow: 1 });
    expect((at(s, 0) as number[]).every((v) => v > 200)).toBe(true);
    expect(at(s, 1)[0] as number).toBeLessThan(at(s, 0)[0] as number); // woods stay darker
    expect(at(s, 2)).toEqual(WATER);
  });

  it('in mostly evergreen woods, leaves most stands green and bares the deciduous ones fully', () => {
    // A 64 x 64 tile of wood under a southern winter: a third of the canopy deciduous and bare.
    const n = 64 * 64;
    const d = px(...Array.from({ length: n }, () => WOOD));
    seasonalisePixels(d, 64, { leafOn: 0.65, autumn: 0, grassGreen: 1, snow: 0, deciduous: 0.35 });
    let green = 0;
    let bare = 0;
    for (let i = 0; i < n; i++) {
      const c = at(d, i);
      if (c[0] === WOOD[0] && c[1] === WOOD[1]) green++;
      else bare++;
    }
    expect(green / n).toBeGreaterThan(0.5);
    expect(bare / n).toBeGreaterThan(0.2);
    // The bare stands are as bare as an all-deciduous wood at leafOn 0.
    const full = px(WOOD);
    seasonalisePixels(full, 1, { leafOn: 0, autumn: 0, grassGreen: 1, snow: 0 });
    const someBare = Array.from({ length: n }, (_, i) => at(d, i)).find(
      (c) => c[0] !== WOOD[0] || c[1] !== WOOD[1],
    );
    expect(someBare).toEqual(at(full, 0));
  });

  it('keys tiles on visible steps only', () => {
    const a = seasonKey({ leafOn: 1, autumn: 0.51, grassGreen: 1, snow: 0 });
    expect(seasonKey({ leafOn: 1, autumn: 0.53, grassGreen: 1, snow: 0 })).toBe(a);
    expect(seasonKey({ leafOn: 1, autumn: 0.8, grassGreen: 1, snow: 0 })).not.toBe(a);
  });
});

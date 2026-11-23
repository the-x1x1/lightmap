import { describe, expect, it } from 'vitest';
import {
  builtUpTest,
  lampFogFade,
  streetLampGlow,
  streetLampPositions,
} from '../src/street-lamps.ts';
import type { StreetLine } from '../src/vector-cover.ts';

const M = 111_320;

describe('street lamps', () => {
  // A straight 350 m road running east along the equator, 9 m wide.
  const road: StreetLine = {
    kind: 'road',
    widthM: 9,
    points: [
      [0, 0],
      [350 / M, 0],
    ],
  };

  it('stands one every 35 m, staggered either side and set back from the centre line', () => {
    const lamps = streetLampPositions([road]);
    expect(lamps).toHaveLength(10);
    expect(lamps[0]![0] * M).toBeCloseTo(17.5, 3);
    expect(lamps[1]![0] * M - lamps[0]![0] * M).toBeCloseTo(35, 3);
    expect(lamps[0]![1] * M).toBeCloseTo(5.5, 3);
    expect(lamps[1]![1] * M).toBeCloseTo(-5.5, 3);
  });

  it('keeps its rhythm across a line of short segments', () => {
    const pts: [number, number][] = [];
    for (let m = 0; m <= 350; m += 10) pts.push([m / M, 0]);
    const lamps = streetLampPositions([{ ...road, points: pts }]);
    expect(lamps).toHaveLength(10);
    expect(lamps[9]![0] * M).toBeCloseTo(332.5, 3);
  });

  it('lights no paths, tracks or narrow service roads', () => {
    expect(streetLampPositions([{ ...road, kind: 'path' }])).toHaveLength(0);
    expect(streetLampPositions([{ ...road, widthM: 4.5 }])).toHaveLength(0);
  });

  it('keeps the nearest lamps when there are too many', () => {
    const lamps = streetLampPositions([road], 35, 3, 350 / M, 0);
    expect(lamps).toHaveLength(3);
    for (const l of lamps) expect(l[0] * M).toBeGreaterThan(240);
  });
});

describe('streetLampGlow', () => {
  it('shows no glow until the lights are half on, all of it when they are fully on', () => {
    expect(streetLampGlow(0)).toBe(0);
    expect(streetLampGlow(0.2)).toBe(0);
    expect(streetLampGlow(0.5)).toBe(0);
    expect(streetLampGlow(0.75)).toBeCloseTo(0.5, 6);
    expect(streetLampGlow(1)).toBe(1);
    expect(streetLampGlow(0.6)).toBeLessThan(streetLampGlow(0.9));
  });
});

describe('lampFogFade', () => {
  it('fades the lamps out a little past the visibility, and not at all in clear air', () => {
    // Tromsø in a drizzle: whole to 400 m, gone at 2.4 km.
    expect(lampFogFade(1600)).toEqual({ nearM: 400, farM: 2400 });
    expect(lampFogFade(80_000)).toBeNull();
    expect(lampFogFade(Infinity)).toBeNull();
    expect(lampFogFade(0)).toBeNull();
  });
});

describe('builtUpTest', () => {
  // About 11 m a 0.0001 deg at the equator.
  const town: [number, number][] = [
    [0, 0],
    [0.0003, 0],
    [0, 0.0003],
    [0.0003, 0.0003],
  ];

  it('lights a street among houses, not the open road beyond them', () => {
    const lit = builtUpTest(town);
    expect(lit(0.0001, 0.0001)).toBe(true);
    expect(lit(0.01, 0)).toBe(false); // 1.1 km out
    expect(lit(0.002, 0)).toBe(true); // 190 m from the two nearer houses
    // One farmhouse by the highway does not light it.
    expect(builtUpTest([[0, 0]])(0, 0.0001)).toBe(false);
    expect(builtUpTest([])(0, 0)).toBe(false);
  });

  it('leaves an open highway dark and lamps the stretch through town', () => {
    const highway = [
      {
        kind: 'road' as const,
        widthM: 14,
        points: [
          [-0.02, 0.0001],
          [0.02, 0.0001],
        ] as [number, number][],
      },
    ];
    const all = streetLampPositions(highway, 35);
    const inTown = streetLampPositions(highway, 35, 6000, undefined, undefined, builtUpTest(town));
    expect(all.length).toBeGreaterThan(100);
    expect(inTown.length).toBeGreaterThan(0);
    expect(inTown.length).toBeLessThan(20);
    for (const [lon] of inTown) expect(Math.abs(lon)).toBeLessThan(0.0025);
  });
});

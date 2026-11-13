import { describe, expect, it } from 'vitest';
import { streetLampPositions } from '../src/street-lamps.ts';
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

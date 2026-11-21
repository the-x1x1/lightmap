import { describe, expect, it } from 'vitest';
import { groundCaughtUp } from '../src/cesium/osm-buildings-layer.ts';

describe('groundCaughtUp', () => {
  const at = (groundM: number, drawnM: number | undefined, distanceM = 500) => ({
    groundM,
    drawnM,
    distanceM,
  });

  it('holds a wood while the coarse first tiles lie well under its slope', () => {
    // Tromsø on arrival: the slope behind the town drawn tens of metres low.
    expect(groundCaughtUp([at(80, 40), at(95, 52), at(110, 61), at(70, 70)])).toBe(false);
  });

  it('lets it go once three in four stand on the terrain drawn', () => {
    expect(groundCaughtUp([at(80, 79), at(95, 96.5), at(110, 108), at(70, 40)])).toBe(true);
  });

  it('allows a far tile its coarser level, and waits for terrain not drawn yet', () => {
    // 2 km out: 3 + 8 m.
    expect(groundCaughtUp([at(200, 191, 2000)])).toBe(true);
    expect(groundCaughtUp([at(200, 188, 2000)])).toBe(false);
    expect(groundCaughtUp([at(200, undefined)])).toBe(false);
    expect(groundCaughtUp([])).toBe(true);
  });
});

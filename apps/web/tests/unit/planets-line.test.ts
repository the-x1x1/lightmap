import { describe, expect, it } from 'vitest';
import type { PlanetPosition } from '@lightmap/astronomy';
import { planetPointInSky } from '@lightmap/renderer';
import { describePlanets, visiblePlanets } from '../../features/planner/planets-line.ts';

const p = (name: PlanetPosition['name'], az: number, el: number, mag: number, elong = 40) =>
  ({
    name,
    azimuthDeg: az,
    elevationDeg: el,
    magnitude: mag,
    elongationDeg: elong,
    rightAscensionDeg: 0,
    declinationDeg: 0,
    distanceAu: 1,
    phaseAngleDeg: 0,
  }) satisfies PlanetPosition;

describe('the planets line', () => {
  const list = [
    p('saturn', 120, 20, 0.9),
    p('venus', 280, 28, -4.2),
    p('mars', 200, -5, 1.1),
    p('mercury', 260, 8, -0.4, 6),
    p('jupiter', 110, 12, -2.1),
  ];

  it('names the planets up, clear of the Sun and bright enough for the sky, brightest first', () => {
    expect(visiblePlanets(list, -10, planetPointInSky).map((x) => x.name)).toEqual([
      'venus',
      'jupiter',
      'saturn',
    ]);
    expect(describePlanets(list, -10, planetPointInSky)).toBe(
      'Venus W 28° (mag −4.2), Jupiter ESE 12° (−2.1), Saturn ESE 20° (+0.9)',
    );
  });

  it('keeps only what a brighter sky lets through; Venus shows at sunset', () => {
    expect(visiblePlanets(list, -3, planetPointInSky).map((x) => x.name)).toEqual([
      'venus',
      'jupiter',
    ]);
    expect(visiblePlanets(list, 0, planetPointInSky).map((x) => x.name)).toEqual(['venus']);
    expect(visiblePlanets([p('venus', 280, 28, -3.9)], 0, planetPointInSky)).toHaveLength(1);
  });

  it('dims a planet low in the air: Mercury 2 deg up is lost, 15 deg up it is seen', () => {
    expect(visiblePlanets([p('mercury', 290, 2, -0.3, 18)], -8, planetPointInSky)).toEqual([]);
    expect(visiblePlanets([p('mercury', 290, 15, -0.3, 18)], -8, planetPointInSky)).toHaveLength(1);
  });

  it('says why none can be seen', () => {
    expect(describePlanets([p('mars', 200, -5, 1.1)], -20, planetPointInSky)).toBe(
      'none visible (all below the horizon)',
    );
    expect(
      describePlanets(
        [p('jupiter', 110, 40, -2.1), p('saturn', 100, 30, 0.9)],
        30,
        planetPointInSky,
      ),
    ).toBe('none visible (Jupiter and Saturn up, in daylight)');
    expect(describePlanets([p('mercury', 100, 5, -1, 4)], -2, planetPointInSky)).toBe(
      "none visible (Mercury up, in the Sun's glare)",
    );
  });
});

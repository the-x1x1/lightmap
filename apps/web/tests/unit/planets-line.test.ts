import { describe, expect, it } from 'vitest';
import type { PlanetPosition } from '@lightmap/astronomy';
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

const limit = (el: number) => (el >= 0 ? -4 : el > -6 ? 0.5 : 6);

describe('the planets line', () => {
  const list = [
    p('saturn', 120, 20, 0.9),
    p('venus', 280, 28, -4.2),
    p('mars', 200, -5, 1.1),
    p('mercury', 260, 8, -0.4, 6),
    p('jupiter', 110, 12, -2.1),
  ];

  it('names the planets up, clear of the Sun and bright enough for the sky, brightest first', () => {
    expect(visiblePlanets(list, -10, limit).map((x) => x.name)).toEqual([
      'venus',
      'jupiter',
      'saturn',
    ]);
    expect(describePlanets(visiblePlanets(list, -10, limit))).toBe(
      'Venus W 28° (mag −4.2), Jupiter ESE 12° (−2.1), Saturn ESE 20° (+0.9)',
    );
  });

  it('keeps only what a brighter sky lets through', () => {
    expect(visiblePlanets(list, -3, limit).map((x) => x.name)).toEqual(['venus', 'jupiter']);
    expect(visiblePlanets(list, 10, limit).map((x) => x.name)).toEqual(['venus']);
    expect(describePlanets([])).toBeNull();
  });
});

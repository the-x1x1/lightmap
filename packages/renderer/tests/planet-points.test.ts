import { describe, expect, it } from 'vitest';
import { planetPoint, skyLimitingMagnitude } from '../src/planet-points.ts';

describe('skyLimitingMagnitude', () => {
  it('deepens monotonically from day to astronomical night', () => {
    expect(skyLimitingMagnitude(10)).toBe(-4);
    expect(skyLimitingMagnitude(-6)).toBeCloseTo(1.5);
    expect(skyLimitingMagnitude(-30)).toBe(6);
    let prev = -Infinity;
    for (let el = 5; el >= -20; el -= 0.5) {
      const m = skyLimitingMagnitude(el);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
});

describe('planetPoint', () => {
  it('hides a planet the sky is too bright for, shows Venus before Saturn', () => {
    expect(planetPoint(1, 0)).toBeNull();
    expect(planetPoint(-4.4, 0)).not.toBeNull();
    // At -3 deg Venus and Jupiter show, Saturn (+0.8) does not yet.
    expect(planetPoint(-2.3, -3)).not.toBeNull();
    expect(planetPoint(0.8, -3)).toBeNull();
    expect(planetPoint(0.8, -8)).not.toBeNull();
  });

  it('is brighter and larger for a brighter planet, saturating at 1', () => {
    const venus = planetPoint(-4.4, -12)!;
    const saturn = planetPoint(0.8, -12)!;
    expect(venus.peak).toBe(1);
    expect(saturn.peak).toBeLessThan(venus.peak);
    expect(venus.sigmaPx).toBeGreaterThan(saturn.sigmaPx);
  });

  it('fades in through the twilight', () => {
    const a = planetPoint(-2.5, -2.5)!.peak;
    const b = planetPoint(-2.5, -5)!.peak;
    expect(b).toBeGreaterThan(a);
  });
});

import { describe, expect, it } from 'vitest';
import { lowlandSnowCover, snowSeasonDaysAtSeaLevel } from '../src/snow-season.ts';
import { snowlineWithLowlandSnow } from '../src/ground-texture.ts';

const FEB_1 = 32;
const JUL_15 = 196;
const NOV_1 = 305;

describe('lowland snow (V&V: Tromso in December, Montreal in February)', () => {
  it('whitens the places that keep a winter snowpack, in the heart of their winter', () => {
    for (const [lat, lon] of [
      [45.5, -73.6], // Montreal
      [55.75, 37.6], // Moscow
      [60.17, 24.94], // Helsinki
      [69.65, 18.96], // Tromso
      [43.06, 141.35], // Sapporo
      [61.2, -149.9], // Anchorage
    ] as const) {
      expect(lowlandSnowCover(lat, lon, FEB_1)).toBe(1);
      expect(lowlandSnowCover(lat, lon, JUL_15)).toBe(0);
    }
  });

  it('leaves bare the places whose snow comes and goes, and the maritime west', () => {
    for (const [lat, lon] of [
      [42.36, -71.06], // Boston
      [41.9, -87.6], // Chicago
      [52.5, 13.4], // Berlin
      [51.5, -0.1], // London
      [60.39, 5.32], // Bergen
      [49.28, -123.1], // Vancouver
      [64.1, -21.9], // Reykjavik
      [39.9, 116.4], // Beijing
      [35.68, 139.69], // Tokyo
      [-45.87, 170.5], // Dunedin
    ] as const) {
      expect(lowlandSnowCover(lat, lon, FEB_1)).toBe(0);
    }
  });

  it('lengthens the season northward and with height, and wraps the New Year', () => {
    expect(snowSeasonDaysAtSeaLevel(55, -97)).toBeGreaterThan(snowSeasonDaysAtSeaLevel(46, -97));
    expect(lowlandSnowCover(43, -90, FEB_1, 0)).toBe(0);
    expect(lowlandSnowCover(43, -90, FEB_1, 900)).toBeGreaterThan(0);
    // Tromso: the whole of December and January, both sides of 1 January.
    expect(lowlandSnowCover(69.65, 18.96, 360)).toBe(1);
    expect(lowlandSnowCover(69.65, 18.96, 5)).toBe(1);
    // Moscow's season has not started on 1 November.
    expect(lowlandSnowCover(55.75, 37.6, NOV_1)).toBe(0);
  });

  it('draws the snowline under the ground by the share covered', () => {
    expect(snowlineWithLowlandSnow(700, 0, 20)).toBe(700);
    expect(snowlineWithLowlandSnow(700, 1, 20)).toBe(-230);
    expect(snowlineWithLowlandSnow(700, 0.5, 20)).toBe(235);
    // A mountain line already under the ground stays.
    expect(snowlineWithLowlandSnow(-400, 1, 20)).toBe(-400);
  });
});

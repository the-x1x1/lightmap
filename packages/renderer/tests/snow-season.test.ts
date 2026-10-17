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
      [52.23, 21.01], // Warsaw
      [50.45, 30.52], // Kyiv
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
    // The Baltic shores keep about four months, not six (St Petersburg, Stockholm).
    expect(snowSeasonDaysAtSeaLevel(59.94, 30.31)).toBeLessThan(140);
    expect(snowSeasonDaysAtSeaLevel(59.33, 18.07)).toBeLessThan(130);
    // Moscow's season has not started on 1 November.
    expect(lowlandSnowCover(55.75, 37.6, NOV_1)).toBe(0);
  });

  it('height lengthens a winter, never paints a high city of the tropics or the south', () => {
    for (const [lat, lon, h] of [
      [19.43, -99.13, 2240], // Mexico City
      [4.71, -74.07, 2640], // Bogota
      [-0.18, -78.47, 2850], // Quito
      [-16.5, -68.15, 3640], // La Paz
      [-1.29, 36.82, 1795], // Nairobi
      [9.03, 38.74, 2355], // Addis Ababa
      [-26.2, 28.05, 1753], // Johannesburg (February is its summer)
      [39.74, -104.99, 1609], // Denver: snow melts within days
      [35.08, -106.65, 1619], // Albuquerque
      [34.53, 69.17, 1790], // Kabul
    ] as const)
      expect(lowlandSnowCover(lat, lon, FEB_1, h)).toBe(0);
    // Height still lengthens a real winter (Calgary on its plateau, the Alps' valleys).
    expect(lowlandSnowCover(51.05, -114.07, FEB_1, 1045)).toBe(1);
  });

  it('draws the snowline under the ground by the share covered', () => {
    expect(snowlineWithLowlandSnow(700, 0, 20)).toBe(700);
    expect(snowlineWithLowlandSnow(700, 1, 20)).toBe(-230);
    expect(snowlineWithLowlandSnow(700, 0.5, 20)).toBe(235);
    // A mountain line already under the ground stays.
    expect(snowlineWithLowlandSnow(-400, 1, 20)).toBe(-400);
  });
});

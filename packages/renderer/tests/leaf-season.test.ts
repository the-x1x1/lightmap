import { describe, expect, it } from 'vitest';
import {
  EVERGREEN,
  leafOutDay,
  leafSeason,
  peakColourDay,
  seasonalClimate,
} from '../src/leaf-season.ts';

// Day of the year for a date in a common year.
const doy = (month: number, day: number) =>
  [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][month - 1]! + day;

describe('leaf season', () => {
  it('keeps the tropics evergreen all year', () => {
    for (const d of [1, 100, 200, 300]) expect(leafSeason(21.3, d)).toEqual(EVERGREEN); // Honolulu
    expect(leafSeason(-8.7, 200)).toEqual(EVERGREEN); // Bali
  });

  it('puts Vermont in full colour in early October and bare by late November', () => {
    const vt = 44.3;
    const oct8 = leafSeason(vt, doy(10, 8), 300);
    expect(oct8.autumn).toBeGreaterThan(0.8);
    expect(oct8.leafOn).toBeGreaterThan(0.85);
    const nov25 = leafSeason(vt, doy(11, 25), 300);
    expect(nov25.leafOn).toBeLessThan(0.05);
    const jul15 = leafSeason(vt, doy(7, 15), 300);
    expect(jul15).toEqual({ leafOn: 1, autumn: 0, grassGreen: 1 });
  });

  it('has Boston bare with dormant grass in January and green in June', () => {
    const jan = leafSeason(42.36, doy(1, 20));
    expect(jan.leafOn).toBe(0);
    expect(jan.grassGreen).toBeLessThan(0.5);
    const jun = leafSeason(42.36, doy(6, 15));
    expect(jun.leafOn).toBe(1);
    expect(jun.autumn).toBe(0);
    expect(jun.grassGreen).toBe(1);
  });

  it('turns New York later than Vermont and Helsinki earlier', () => {
    expect(peakColourDay(40.78)).toBeGreaterThan(peakColourDay(44.3, 300));
    expect(peakColourDay(60.17)).toBeLessThan(peakColourDay(44.3, 300));
    expect(leafOutDay(35.7)).toBeLessThan(leafOutDay(45.5)); // Tokyo before Montreal
  });

  it('flips the seasons across the equator', () => {
    // Christchurch (43.5° S) in April is autumn; in October, spring.
    const apr = leafSeason(-43.5, doy(4, 20));
    expect(apr.autumn).toBeGreaterThan(0.5);
    const jul = leafSeason(-43.5, doy(7, 15));
    expect(jul.leafOn).toBeLessThan(0.1);
    const jan = leafSeason(-43.5, doy(1, 15));
    expect(jan.leafOn).toBe(1);
  });

  it('brings spring later and autumn earlier up a mountain', () => {
    expect(leafOutDay(46, 1500)).toBeGreaterThan(leafOutDay(46, 0) + 30);
    expect(peakColourDay(46, 1500)).toBeLessThan(peakColourDay(46, 0) - 25);
  });

  it('only half-turns the subtropics', () => {
    // Atlanta's latitude (33.7°) is almost fully seasonal; Miami (25.8°) barely.
    expect(leafSeason(25.8, doy(1, 15)).leafOn).toBeGreaterThan(0.9);
    expect(leafSeason(33.7, doy(1, 15)).leafOn).toBeLessThan(0.1);
  });

  it('gives the maritime west coasts an earlier spring, a later autumn and greener winter grass', () => {
    expect(seasonalClimate(51.5, -0.13).maritime).toBe(1); // London
    expect(seasonalClimate(47.6, -122.3).maritime).toBe(1); // Seattle
    expect(seasonalClimate(60.17, 24.94).maritime).toBeLessThan(0.15); // Helsinki
    expect(seasonalClimate(42.36, -71.06).maritime).toBe(0); // Boston
    const london = { lat: 51.5, lon: -0.13 };
    // In leaf by early May, at peak colour in late October, grass green in January.
    expect(leafSeason(london.lat, doy(5, 5), 0, london.lon).leafOn).toBeGreaterThan(0.9);
    expect(leafSeason(london.lat, doy(10, 25), 0, london.lon).autumn).toBeGreaterThan(0.9);
    expect(leafSeason(london.lat, doy(10, 25), 0, london.lon).leafOn).toBeGreaterThan(0.6);
    expect(leafSeason(london.lat, doy(1, 15), 0, london.lon).grassGreen).toBeGreaterThan(0.7);
  });

  it("turns southern Japan's maples late", () => {
    const kyoto = { lat: 35.01, lon: 135.77 };
    expect(leafSeason(kyoto.lat, doy(11, 20), 0, kyoto.lon).autumn).toBeGreaterThan(0.9);
    expect(leafSeason(kyoto.lat, doy(11, 20), 0, kyoto.lon).leafOn).toBeGreaterThan(0.7);
    expect(leafSeason(kyoto.lat, doy(10, 10), 0, kyoto.lon).autumn).toBeLessThan(0.3);
  });
});

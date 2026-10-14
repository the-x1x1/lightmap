import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { geoidCellKey, geoidHeightM } from '../src/geoid.ts';

const cell = (key: string) => {
  const b = readFileSync(
    new URL(`../../../apps/web/public/data/geoid/${key}.bin`, import.meta.url),
  );
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const at = (lat: number, lon: number) => {
  const key = geoidCellKey(lat, lon);
  return geoidHeightM(cell(key), key, lat, lon);
};

describe('geoid', () => {
  it('names the cell around a point, longitudes wrapped, poles included', () => {
    expect(geoidCellKey(21.3, -157.86)).toBe('0_-6');
    expect(geoidCellKey(38.9, -77)).toBe('1_-3');
    expect(geoidCellKey(-33.9, 151.2)).toBe('-2_5');
    expect(geoidCellKey(90, 0)).toBe('2_0');
    expect(geoidCellKey(-90, 180)).toBe('-3_-6');
    expect(geoidCellKey(10, 190)).toBe('0_-6');
  });

  it('matches known EGM96 heights to the decimetre', () => {
    // Reference values from the full 15-minute grid.
    expect(at(0, 0)).toBeCloseTo(17.16, 0);
    expect(at(38.9, -77.04)).toBeCloseTo(-33.25, 0);
    expect(at(21.3069, -157.8583)).toBeCloseTo(14.86, 0);
    expect(at(52.37, 4.9)).toBeCloseTo(42.94, 0);
  });

  it('is continuous across a cell edge', () => {
    const west = at(30, -60.0001)!;
    const east = at(30, -59.9999)!;
    expect(Math.abs(west - east)).toBeLessThan(0.05);
    const south = at(29.9999, 10)!;
    const north = at(30.0001, 10)!;
    expect(Math.abs(south - north)).toBeLessThan(0.05);
  });

  it('refuses bytes of the wrong size or a point outside the cell', () => {
    expect(geoidHeightM(new ArrayBuffer(10), '0_0', 1, 1)).toBeNull();
    expect(geoidHeightM(cell('0_0'), '0_0', 45, 1)).toBeNull();
  });
});

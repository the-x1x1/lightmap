import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coverMosaicFor } from '../src/land-cover.ts';
import { decodeUrbanCell, mosaicBox, mosaicPixel, urbanCellsFor } from '../src/urban-areas.ts';

describe('urban areas', () => {
  it('names the 10° cells a box touches, wrapping across the antimeridian', () => {
    expect(urbanCellsFor({ west: -158, east: -157.5, south: 21.2, north: 21.5 })).toEqual([
      '2_-16',
    ]);
    expect(urbanCellsFor({ west: 9.9, east: 10.1, south: -0.1, north: 0.1 })).toEqual([
      '-1_0',
      '-1_1',
      '0_0',
      '0_1',
    ]);
    expect(urbanCellsFor({ west: 179.9, east: 180.1, south: 1, north: 2 })).toEqual([
      '0_17',
      '0_-18',
    ]);
  });

  it('decodes delta-encoded rings from the cell corner and skips malformed ones', () => {
    const polys = decodeUrbanCell(
      { v: 1, q: 10000, polys: [[[1000, 2000, 10, 0, 0, 10, -10, 0]], [[1, 2, 3]], 'junk'] },
      '2_-16',
    );
    expect(polys).toHaveLength(1);
    const ring = polys[0]![0]!;
    expect(ring[0]![0]).toBeCloseTo(-160 + 0.1, 9);
    expect(ring[0]![1]).toBeCloseTo(20 + 0.2, 9);
    expect(ring[1]![0]).toBeCloseTo(-160 + 0.101, 9);
    expect(ring[3]![1]).toBeCloseTo(20 + 0.201, 9);
    expect(decodeUrbanCell(null, '2_-16')).toEqual([]);
    expect(decodeUrbanCell({ polys: [] }, 'bad')).toEqual([]);
  });

  it('projects onto the cover mosaic: the pin near the middle, north at the top', () => {
    const p = { latitude: 21.3069, longitude: -157.8583 };
    const m = coverMosaicFor(p, 12);
    const box = mosaicBox(m);
    expect(box.west).toBeLessThan(p.longitude);
    expect(box.east).toBeGreaterThan(p.longitude);
    expect(box.south).toBeLessThan(p.latitude);
    expect(box.north).toBeGreaterThan(p.latitude);
    const [x, y] = mosaicPixel(m, 768, 768, p.longitude, p.latitude);
    expect(x).toBeGreaterThan(256);
    expect(x).toBeLessThan(512);
    expect(y).toBeGreaterThan(256);
    expect(y).toBeLessThan(512);
    const [, yNorth] = mosaicPixel(m, 768, 768, p.longitude, box.north);
    expect(yNorth).toBeCloseTo(0, 6);
  });

  it('the bundled data: an index of cells, and Honolulu inside its cell', () => {
    const base = new URL('../../../apps/web/public/data/urban/', import.meta.url);
    const index = JSON.parse(readFileSync(new URL('index.json', base), 'utf8')) as {
      cells: string[];
    };
    expect(index.cells.length).toBeGreaterThan(150);
    expect(index.cells).toContain('2_-16');
    const cell = decodeUrbanCell(
      JSON.parse(readFileSync(new URL('2_-16.json', base), 'utf8')),
      '2_-16',
    );
    // Some polygon's outline contains downtown Honolulu (ray casting).
    const inside = (ring: Array<[number, number]>, x: number, y: number) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    expect(cell.some((poly) => inside(poly[0]!, -157.8583, 21.3069))).toBe(true);
  });
});

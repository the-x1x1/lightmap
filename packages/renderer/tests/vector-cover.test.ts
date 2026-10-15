import { describe, expect, it } from 'vitest';
import { coverShapesFromTile } from '../src/vector-cover.ts';

// Minimal MVT encoding (see osm-buildings.test.ts for the full helper).
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
};
const key = (field: number, wire: number) => varint(field * 8 + wire);
const bytes = (field: number, payload: number[]) => [
  ...key(field, 2),
  ...varint(payload.length),
  ...payload,
];
const str = (field: number, s: string) => bytes(field, [...new TextEncoder().encode(s)]);
const zz = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
const packed = (field: number, xs: number[]) => bytes(field, xs.flatMap(varint));
const square = (x: number, y: number, s: number) => [
  (1 << 3) | 1,
  zz(x),
  zz(y),
  (3 << 3) | 2,
  zz(s),
  0,
  0,
  zz(s),
  zz(-s),
  0,
  (1 << 3) | 7,
];
const layer = (name: string, cls: string, sub = '') =>
  bytes(3, [
    ...key(15, 0),
    2,
    ...str(1, name),
    ...bytes(2, [
      ...packed(2, sub ? [0, 0, 1, 1] : [0, 0]),
      ...key(3, 0),
      3,
      ...packed(4, square(10, 10, 100)),
    ]),
    ...str(3, 'class'),
    ...(sub ? str(3, 'subclass') : []),
    ...bytes(4, str(1, cls)),
    ...(sub ? bytes(4, str(1, sub)) : []),
    ...key(5, 0),
    ...varint(4096),
  ]);

describe('OpenStreetMap land cover', () => {
  it('maps land use, land cover and water to cover classes, water painted last', () => {
    const tile = new Uint8Array([
      ...layer('water', 'ocean'),
      ...layer('landcover', 'wood', 'forest'),
      ...layer('landuse', 'residential'),
    ]);
    const shapes = coverShapesFromTile(tile, 12, 100, 100);
    expect(shapes.map((s) => s.cls)).toEqual(['built', 'tree', 'water']);
    expect(shapes[0]?.rings[0]).toHaveLength(4);
    const cls = (c: string, sub: string) =>
      coverShapesFromTile(new Uint8Array(layer('landcover', c, sub)), 12, 0, 0)[0]?.cls;
    expect(cls('grass', 'park')).toBe('grass');
    expect(cls('grass', 'scrub')).toBe('shrub');
    expect(cls('farmland', 'farmland')).toBe('crop');
    expect(cls('sand', 'beach')).toBe('bare');
  });

  it('ignores classes it has no cover for', () => {
    const tile = new Uint8Array([
      ...layer('landuse', 'kindergarten'),
      ...layer('landcover', 'unknown'),
    ]);
    expect(coverShapesFromTile(tile, 12, 0, 0)).toEqual([]);
  });
});

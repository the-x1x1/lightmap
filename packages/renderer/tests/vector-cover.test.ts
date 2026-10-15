import { describe, expect, it } from 'vitest';
import {
  bridgeAt,
  bridgeLinesFromTile,
  coverShapesFromTile,
  streetLinesFromTile,
} from '../src/vector-cover.ts';

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

const lineTile = (props: [string, string][]) => {
  const keys = props.map(([k]) => k);
  const tags = props.flatMap((_, i) => [i, i]);
  const line = [(1 << 3) | 1, zz(0), zz(0), (1 << 3) | 2, zz(400), zz(0)];
  return new Uint8Array(
    bytes(3, [
      ...key(15, 0),
      2,
      ...str(1, 'transportation'),
      ...bytes(2, [...packed(2, tags), ...key(3, 0), 2, ...packed(4, line)]),
      ...keys.flatMap((k) => str(3, k)),
      ...props.flatMap(([, v]) => bytes(4, str(1, v))),
      ...key(5, 0),
      ...varint(4096),
    ]),
  );
};

describe('OpenStreetMap streets', () => {
  it('reads roads to their width by class, paths as paving, and skips bridges', () => {
    const primary = streetLinesFromTile(lineTile([['class', 'primary']]), 14, 0, 0);
    expect(primary).toHaveLength(1);
    expect(primary[0]).toMatchObject({ kind: 'road', widthM: 14 });
    expect(primary[0]?.points).toHaveLength(2);
    const foot = streetLinesFromTile(
      lineTile([
        ['class', 'path'],
        ['subclass', 'footway'],
      ]),
      14,
      0,
      0,
    );
    expect(foot[0]).toMatchObject({ kind: 'path' });
    const ped = streetLinesFromTile(
      lineTile([
        ['class', 'minor'],
        ['subclass', 'pedestrian'],
      ]),
      14,
      0,
      0,
    );
    expect(ped[0]).toMatchObject({ kind: 'path', widthM: 6 });
    expect(
      streetLinesFromTile(
        lineTile([
          ['class', 'primary'],
          ['brunnel', 'bridge'],
        ]),
        14,
        0,
        0,
      ),
    ).toEqual([]);
    expect(streetLinesFromTile(lineTile([['class', 'rail']]), 14, 0, 0)).toEqual([]);
  });
});

describe('bridges (V&V: Waterloo Bridge stood the eye at the river)', () => {
  it('reads bridge decks at their width, and nothing else', () => {
    const deck = bridgeLinesFromTile(
      lineTile([
        ['class', 'primary'],
        ['brunnel', 'bridge'],
      ]),
      14,
      0,
      0,
    );
    expect(deck).toHaveLength(1);
    expect(deck[0]!.widthM).toBe(14);
    expect(bridgeLinesFromTile(lineTile([['class', 'primary']]), 14, 0, 0)).toEqual([]);
    const rail = bridgeLinesFromTile(
      lineTile([
        ['class', 'rail'],
        ['brunnel', 'bridge'],
      ]),
      14,
      0,
      0,
    );
    expect(rail[0]!.widthM).toBe(6);
  });

  it('finds the bridge under a point within half its width and two metres', () => {
    // Waterloo Bridge, roughly: an 11 m deck from the Strand to the South Bank.
    const b = {
      widthM: 11,
      points: [
        [-0.11905, 51.51003],
        [-0.11465, 51.50597],
      ] as [number, number][],
    };
    expect(bridgeAt([b], -0.11685, 51.508)).toBe(b);
    // 30 m off the line: the river, not the bridge.
    expect(
      bridgeAt([b], -0.11685 + 30 / (111_320 * Math.cos((51.508 * Math.PI) / 180)), 51.508),
    ).toBe(null);
  });
});

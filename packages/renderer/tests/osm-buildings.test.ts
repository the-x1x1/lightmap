import { describe, expect, it } from 'vitest';
import {
  BUILDINGS_PER_STEP,
  buildingTilesAround,
  buildingsFromTile,
  buildingsFromTileSteps,
  DEFAULT_BUILDING_HEIGHT_M,
  tileUrl,
  treesFromTile,
} from '../src/osm-buildings.ts';
import {
  classifyRings,
  clipRing,
  decodeGeometry,
  lonLatToTile,
  readVectorTile,
  ringArea2,
  tilePointToLonLat,
} from '../src/vector-tile.ts';

// --- a tiny MVT encoder, enough to build test tiles --------------------------------------------
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
const doubleValue = (v: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...key(3, 1), ...b];
};

/** Geometry commands for closed rings given as absolute [x, y] lists. */
function ringCommands(rings: [number, number][][]): number[] {
  const out: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const ring of rings) {
    const [first, ...rest] = ring;
    if (!first) continue;
    out.push((1 << 3) | 1, zz(first[0] - cx), zz(first[1] - cy));
    [cx, cy] = first;
    out.push((rest.length << 3) | 2);
    for (const [x, y] of rest) {
      out.push(zz(x - cx), zz(y - cy));
      cx = x;
      cy = y;
    }
    out.push((1 << 3) | 7);
  }
  return out;
}

function tile(
  features: { rings: [number, number][][]; tags: number[] }[],
  keys: string[],
  values: number[][],
  name = 'building',
): Uint8Array {
  const layer = [
    ...key(15, 0),
    ...varint(2),
    ...str(1, name),
    ...features.flatMap((f) =>
      bytes(2, [
        ...packed(2, f.tags),
        ...key(3, 0),
        ...varint(3),
        ...packed(4, ringCommands(f.rings)),
      ]),
    ),
    ...keys.flatMap((k) => str(3, k)),
    ...values.flatMap((v) => bytes(4, v)),
    ...key(5, 0),
    ...varint(4096),
  ];
  return new Uint8Array(bytes(3, layer));
}

// A clockwise square in tile coordinates (y down) is an exterior ring.
const square = (x0: number, y0: number, s: number): [number, number][] => [
  [x0, y0],
  [x0 + s, y0],
  [x0 + s, y0 + s],
  [x0, y0 + s],
];

describe('vector tile reader', () => {
  it('decodes command geometry with zig-zag deltas', () => {
    const rings = decodeGeometry(ringCommands([square(10, 20, 5)]));
    expect(rings).toEqual([[10, 20, 15, 20, 15, 25, 10, 25]]);
  });

  it('reads layers, keys, values and polygon features', () => {
    const t = tile(
      [{ rings: [square(100, 100, 200)], tags: [0, 0, 1, 1] }],
      ['render_height', 'colour'],
      [doubleValue(24.5), str(1, '#aabbcc')],
    );
    const layers = readVectorTile(t);
    const b = layers['building'];
    expect(b?.extent).toBe(4096);
    expect(b?.features).toHaveLength(1);
    expect(b?.features[0]?.properties).toEqual({ render_height: 24.5, colour: '#aabbcc' });
    expect(b?.features[0]?.type).toBe(3);
  });

  it('only returns the layers asked for', () => {
    const t = tile([{ rings: [square(0, 0, 10)], tags: [] }], [], [], 'water');
    expect(readVectorTile(t, ['building'])).toEqual({});
    expect(Object.keys(readVectorTile(t))).toEqual(['water']);
  });

  it('tells exterior rings from holes by their winding', () => {
    const outer = square(0, 0, 100).flat();
    const hole = square(25, 25, 50).reverse().flat();
    expect(ringArea2(outer)).toBeGreaterThan(0);
    expect(ringArea2(hole)).toBeLessThan(0);
    expect(classifyRings([outer, hole])).toEqual([{ outer, holes: [hole] }]);
  });

  it('clips rings to the tile', () => {
    const r = clipRing(square(-50, 10, 100).flat(), 0, 4096);
    const xs = r.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(50);
  });

  it('maps tile corners to longitude and latitude and back', () => {
    const [lon, lat] = tilePointToLonLat(14, 4093, 7277, 4096, 0, 0);
    expect(lonLatToTile(14, lon + 1e-6, lat - 1e-6)).toEqual({ x: 4093, y: 7277 });
    expect(tilePointToLonLat(0, 0, 0, 4096, 2048, 2048)).toEqual([0, 0]);
  });
});

describe('OSM buildings from a tile', () => {
  it('extrudes each footprint to its render height, with a default when it has none', () => {
    const t = tile(
      [
        { rings: [square(1000, 1000, 40)], tags: [0, 0] },
        { rings: [square(2000, 2000, 40)], tags: [] },
      ],
      ['render_height'],
      [doubleValue(30)],
    );
    const b = buildingsFromTile(t, 14, 4093, 7277);
    expect(b.map((x) => x.heightM)).toEqual([30, DEFAULT_BUILDING_HEIGHT_M]);
    expect(b[0]?.outer).toHaveLength(4);
    const [lon, lat] = b[0]?.centre ?? [0, 0];
    expect(lonLatToTile(14, lon, lat)).toEqual({ x: 4093, y: 7277 });
  });

  it('skips outlines marked hide_3d (their parts are drawn instead)', () => {
    const t = tile([{ rings: [square(0, 0, 40)], tags: [0, 0] }], ['hide_3d'], [[...key(7, 0), 1]]);
    expect(buildingsFromTile(t, 14, 0, 0)).toEqual([]);
  });

  it('lists the tiles around a point, nearest first', () => {
    const tiles = buildingTilesAround(-157.8583, 21.3069, 1500);
    expect(tiles[0]).toEqual(lonLatToTile(14, -157.8583, 21.3069));
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(tiles.length).toBeLessThanOrEqual(16);
  });

  it('fills a tile template', () => {
    expect(tileUrl('https://t/p/{z}/{x}/{y}.pbf', 14, 1, 2)).toBe('https://t/p/14/1/2.pbf');
  });
});

describe('trees from land cover', () => {
  const landcover = (cls: string, sub: string, ring: [number, number][]) =>
    tile(
      [{ rings: [ring], tags: [0, 0, 1, 1] }],
      ['class', 'subclass'],
      [str(1, cls), str(1, sub)],
      'landcover',
    );

  it('fills a wood densely, scatters a park, and ignores farmland', () => {
    const z = 14;
    const lat = 21.3;
    const wood = treesFromTile(landcover('wood', 'wood', square(0, 0, 1024)), z, 4093, 7277, lat);
    const park = treesFromTile(landcover('grass', 'park', square(0, 0, 1024)), z, 4093, 7277, lat);
    const farm = treesFromTile(
      landcover('farmland', 'farmland', square(0, 0, 1024)),
      z,
      4093,
      7277,
      lat,
    );
    // A quarter tile at z14 near 21° N is ~570 m square: ~2700 trees at 11 m, ~360 at 30 m.
    expect(wood.length).toBeGreaterThan(2000);
    expect(wood.length).toBeLessThan(3500);
    expect(park.length).toBeGreaterThan(250);
    expect(park.length).toBeLessThan(500);
    expect(farm).toEqual([]);
    for (const t of wood.slice(0, 50)) {
      expect(t.heightM).toBeGreaterThanOrEqual(9);
      expect(t.heightM).toBeLessThanOrEqual(18);
      expect(lonLatToTile(z, t.lon, t.lat)).toEqual({ x: 4093, y: 7277 });
    }
  });

  it('grows the same trees every time and none in a hole', () => {
    const outer = square(0, 0, 2048);
    const hole = square(512, 512, 1024).reverse();
    const t = tile(
      [{ rings: [outer, hole], tags: [0, 0, 1, 1] }],
      ['class', 'subclass'],
      [str(1, 'wood'), str(1, 'forest')],
      'landcover',
    );
    const a = treesFromTile(t, 14, 10, 10, 45);
    const b = treesFromTile(t, 14, 10, 10, 45);
    expect(a).toEqual(b);
    const [hx0, hy1] = tilePointToLonLat(14, 10, 10, 4096, 560, 1480);
    const [hx1, hy0] = tilePointToLonLat(14, 10, 10, 4096, 1480, 560);
    expect(a.some((p) => p.lon > hx0 && p.lon < hx1 && p.lat > hy1 && p.lat < hy0)).toBe(false);
    expect(a.some((p) => p.conifer)).toBe(true);
  });
});

describe('decoding a dense tile in steps', () => {
  it('yields every few hundred features and returns what the one-shot decode does', () => {
    const feats = [];
    for (let i = 0; i < 40; i++)
      for (let j = 0; j < 30; j++)
        feats.push({ rings: [square(20 + i * 100, 20 + j * 130, 40)], tags: [0, 0] });
    const t = tile(feats, ['render_height'], [doubleValue(12)]);
    const steps = buildingsFromTileSteps(t, 14, 8000, 5000);
    let yields = 0;
    let r = steps.next();
    while (!r.done) {
      yields++;
      r = steps.next();
    }
    expect(yields).toBe(Math.floor((feats.length - 1) / BUILDINGS_PER_STEP));
    expect(r.value).toEqual(buildingsFromTile(t, 14, 8000, 5000));
    expect(r.value).toHaveLength(feats.length);
  });
});

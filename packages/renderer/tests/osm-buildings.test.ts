import { describe, expect, it } from 'vitest';
import {
  BUILDINGS_PER_STEP,
  buildingTilesAround,
  buildingsFromTile,
  buildingsFromTileSteps,
  DEFAULT_BUILDING_HEIGHT_M,
  tileUrl,
  treesFromTile,
  treeMix,
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
function ringCommands(rings: [number, number][][], close = true): number[] {
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
    if (close) out.push((1 << 3) | 7);
  }
  return out;
}

function tile(
  features: { rings: [number, number][][]; tags: number[] }[],
  keys: string[],
  values: number[][],
  name = 'building',
  geomType = 3,
): Uint8Array {
  const layer = [
    ...key(15, 0),
    ...varint(2),
    ...str(1, name),
    ...features.flatMap((f) =>
      bytes(2, [
        ...packed(2, f.tags),
        ...key(3, 0),
        ...varint(geomType),
        ...packed(4, ringCommands(f.rings, geomType === 3)),
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

  it('marks a footprint its tile cut, and no other', () => {
    const t = tile(
      [
        // Inside the tile; across its east edge (into the buffer); across its north edge.
        { rings: [square(100, 100, 200)], tags: [] },
        { rings: [square(4000, 500, 200)], tags: [] },
        { rings: [square(900, -50, 120)], tags: [] },
      ],
      [],
      [],
    );
    const [inside, east, north] = buildingsFromTile(t, 14, 8000, 5000);
    expect(inside?.atTileEdge).toBeUndefined();
    expect('atTileEdge' in (inside ?? {})).toBe(false);
    expect(east?.atTileEdge).toBe(true);
    expect(north?.atTileEdge).toBe(true);
    // The cut piece ends at the edge: 96 of the 200 units wide.
    const lons = (east?.outer ?? []).map((p) => p[0]);
    const [w] = tilePointToLonLat(14, 8000, 5000, 4096, 4000, 0);
    const [e] = tilePointToLonLat(14, 8000, 5000, 4096, 4096, 0);
    expect(Math.min(...lons)).toBeCloseTo(w, 9);
    expect(Math.max(...lons)).toBeCloseTo(e, 9);
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
      expect(t.heightM).toBeGreaterThanOrEqual(7);
      expect(t.heightM).toBeLessThanOrEqual(24);
      expect(lonLatToTile(z, t.lon, t.lat)).toEqual({ x: 4093, y: 7277 });
    }
  });

  it('grows the trees of the climate, not one round crown everywhere', () => {
    const z = 14;
    const share = (trees: { form: string }[], form: string) =>
      trees.filter((t) => t.form === form).length / trees.length;
    // Honolulu (21 N): a park of palms, spreading umbrella trees and ironwoods, no conifers.
    const tropicPark = treesFromTile(
      landcover('grass', 'park', square(0, 0, 4096)),
      z,
      4093,
      7277,
      21.3,
    );
    expect(share(tropicPark, 'palm')).toBeGreaterThan(0.25);
    expect(share(tropicPark, 'umbrella')).toBeGreaterThan(0.25);
    expect(tropicPark.some((t) => t.conifer)).toBe(false);
    expect(share(tropicPark, 'ironwood')).toBeGreaterThan(0.08);
    expect(tropicPark.every((t) => t.park)).toBe(true);
    // The boreal north (Tromso, 69.6 N): a forest mostly of spruce spires and pines.
    const boreal = treesFromTile(
      landcover('wood', 'forest', square(0, 0, 4096)),
      z,
      9054,
      3712,
      69.6,
    );
    expect(share(boreal, 'columnar') + share(boreal, 'conifer')).toBeGreaterThan(0.65);
    expect(boreal.some((t) => t.form === 'palm')).toBe(false);
    // Seattle's woods are mostly fir, cedar and hemlock; Ohio's mostly broad-leaf.
    expect(
      treeMix(47.66, -122.41, false, false).conifer +
        treeMix(47.66, -122.41, false, false).columnar,
    ).toBeGreaterThan(0.6);
    expect(treeMix(40.0, -83.0, false, false).broadleaf).toBeGreaterThan(0.6);
    const places: [number, number][] = [
      [21.3, -157.8],
      [43.7, 7.3],
      [47.66, -122.41],
      [33.7, -84.4],
      [48.9, 2.3],
      [69.6, 18.9],
    ];
    for (const [lat, lon] of places) {
      for (const park of [true, false]) {
        const m = treeMix(lat, lon, park, false);
        expect(Object.values(m).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      }
    }
    // Each build keeps its proportions: a spire is narrow, an umbrella wide, a palm's crown its fronds.
    for (const t of [...tropicPark, ...boreal].slice(0, 400)) {
      if (t.form === 'columnar') expect(t.radiusM / t.heightM).toBeLessThan(0.16);
      if (t.form === 'umbrella') expect(t.radiusM / t.heightM).toBeGreaterThan(0.55);
      if (t.form === 'palm') expect(t.radiusM).toBeLessThanOrEqual(5);
      if (t.form === 'ironwood') expect(t.heightM).toBeGreaterThanOrEqual(12);
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

describe('yard trees in a town', () => {
  const area = (name: string, cls: string, ring: [number, number][]) =>
    tile([{ rings: [ring], tags: [0, 0] }], ['class'], [str(1, cls)], name);
  const join = (...parts: Uint8Array[]) => {
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return all;
  };
  const z = 14;
  const lat = 64.84; // Fairbanks

  it('scatters trees through a residential area with no wood or park mapped', () => {
    const t = area('landuse', 'residential', square(0, 0, 2048));
    const trees = treesFromTile(t, z, 1900, 2000, lat);
    // A quarter tile at 65 N is ~520 m square: ~260 spots at 32 m, about half kept.
    expect(trees.length).toBeGreaterThan(80);
    expect(trees.length).toBeLessThan(200);
    expect(trees.every((p) => p.park)).toBe(true);
    expect(treesFromTile(t, z, 1900, 2000, lat)).toEqual(trees);
    // Not on farmland, not past the tree line, not in a commercial block.
    expect(
      treesFromTile(area('landuse', 'farmland', square(0, 0, 2048)), z, 1900, 2000, lat),
    ).toEqual([]);
    expect(treesFromTile(t, z, 1900, 2000, 71)).toEqual([]);
    expect(
      treesFromTile(area('landuse', 'commercial', square(0, 0, 2048)), z, 1900, 2000, lat),
    ).toEqual([]);
  });

  it('keeps the street clear', () => {
    const res = area('landuse', 'residential', square(0, 0, 2048));
    // A minor street (7 m) across the middle of the square, west to east.
    const street = tile(
      [
        {
          rings: [
            [
              [0, 1024],
              [2048, 1024],
            ],
          ],
          tags: [0, 0],
        },
      ],
      ['class'],
      [str(1, 'minor')],
      'transportation',
      2,
    );
    const alone = treesFromTile(res, z, 1900, 2000, lat);
    const withStreet = treesFromTile(join(res, street), z, 1900, 2000, lat);
    // Within 3.5 + 1.5 m of the street's line (in tile units at this latitude).
    const tileM = (40_075_016 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    const [, yLine] = tilePointToLonLat(z, 1900, 2000, 4096, 0, 1024);
    const [, yOff] = tilePointToLonLat(z, 1900, 2000, 4096, 0, 1024 + (5 * 4096) / tileM);
    const near = (p: { lat: number }) => Math.abs(p.lat - yLine) < Math.abs(yOff - yLine);
    expect(alone.some(near)).toBe(true);
    expect(withStreet.some(near)).toBe(false);
    expect(withStreet.length).toBe(alone.filter((p) => !near(p)).length);
  });

  it('grows none on a house, and none over again where a wood already stands', () => {
    const res = area('landuse', 'residential', square(0, 0, 2048));
    const alone = treesFromTile(res, z, 1900, 2000, lat);
    const house = area('building', 'house', square(0, 0, 1024));
    const withHouse = treesFromTile(join(res, house), z, 1900, 2000, lat);
    const [hx0, hy1] = tilePointToLonLat(z, 1900, 2000, 4096, 0, 1024);
    const [hx1, hy0] = tilePointToLonLat(z, 1900, 2000, 4096, 1024, 0);
    const inHouse = (p: { lon: number; lat: number }) =>
      p.lon > hx0 && p.lon < hx1 && p.lat > hy1 && p.lat < hy0;
    expect(alone.some(inHouse)).toBe(true);
    expect(withHouse.some(inHouse)).toBe(false);
    const wood = tile(
      [{ rings: [square(0, 0, 1024)], tags: [0, 0, 1, 1] }],
      ['class', 'subclass'],
      [str(1, 'wood'), str(1, 'wood')],
      'landcover',
    );
    const both = treesFromTile(join(res, wood), z, 1900, 2000, lat);
    const woodOnly = treesFromTile(wood, z, 1900, 2000, lat);
    // The wood's own trees, plus the yard trees outside it: none of the yard's inside it.
    expect(both.filter((p) => p.park && inHouse(p))).toEqual([]);
    expect(both.length).toBe(woodOnly.length + alone.filter((p) => !inHouse(p)).length);
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
    // The per-row latitude and the linear longitude agree with the tile maths, vertex by vertex.
    const first = r.value[0]!;
    const [lon, lat] = tilePointToLonLat(14, 8000, 5000, 4096, 20, 20);
    expect(first.outer[0]![0]).toBeCloseTo(lon, 10);
    expect(first.outer[0]![1]).toBeCloseTo(lat, 10);
    const last = r.value[r.value.length - 1]!;
    const [lon2, lat2] = tilePointToLonLat(14, 8000, 5000, 4096, 20 + 39 * 100 + 40, 20 + 29 * 130);
    expect(last.outer[1]![0]).toBeCloseTo(lon2, 10);
    expect(last.outer[1]![1]).toBeCloseTo(lat2, 10);
  });
});

// A made-up town served as OpenMapTiles vector tiles, so the harness can run the app's own
// buildings layer (osm-buildings-layer.ts) end to end - the TileJSON, the tiles, their decoding,
// the ground under each footprint, the geometry built in Cesium's workers, the layer's shaders
// and the roof heights the horizon reads - where the buildings stage draws only hand-made boxes
// with those shaders. The tiles are made in the page and handed to `fetch`; nothing is on disk.
//
// The town, in metres east and north of its centre: a street of houses running north, mid-rise
// blocks beyond them (one L-shaped, one round a courtyard), a tower with its own colour, a
// podium with a tower standing on it (a building part), a building with no height mapped, one
// the map says not to draw, a mixed forest with a clearing to the east and a park to the west.

const Z = 14;
const EXTENT = 4096;
/** Tile units of margin kept round a tile, as real tiles carry a buffer. */
const BUFFER = 64;

// --- Mapbox Vector Tile encoding (protobuf), enough for polygons with tags ---------------------
const varint = (n) => {
  const out = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
};
const key = (field, wire) => varint(field * 8 + wire);
const bytes = (field, payload) => [...key(field, 2), ...varint(payload.length), ...payload];
const str = (field, s) => bytes(field, [...new TextEncoder().encode(s)]);
const zigzag = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
const packed = (field, xs) => bytes(field, xs.flatMap(varint));
const value = (v) => {
  if (typeof v === 'string') return str(1, v);
  if (typeof v === 'boolean') return [...key(7, 0), v ? 1 : 0];
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...key(3, 1), ...b];
};
const area2 = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a;
};
/** Geometry commands for closed rings: the first wound as an exterior ring, the rest as holes. */
function ringCommands(rings) {
  const out = [];
  let cx = 0;
  let cy = 0;
  rings.forEach((ring, i) => {
    const wantPositive = i === 0;
    const r = area2(ring) > 0 === wantPositive ? ring : [...ring].reverse();
    const [first, ...rest] = r;
    out.push((1 << 3) | 1, zigzag(first[0] - cx), zigzag(first[1] - cy));
    [cx, cy] = first;
    out.push((rest.length << 3) | 2);
    for (const [x, y] of rest) {
      out.push(zigzag(x - cx), zigzag(y - cy));
      cx = x;
      cy = y;
    }
    out.push((1 << 3) | 7);
  });
  return out;
}
/** One layer: features as { rings, properties }. */
function layer(name, features) {
  const keys = [];
  const values = [];
  const valueIndex = new Map();
  const body = features.flatMap((f) => {
    const tags = [];
    for (const [k, v] of Object.entries(f.properties)) {
      let ki = keys.indexOf(k);
      if (ki < 0) ki = keys.push(k) - 1;
      const vk = typeof v + ':' + v;
      let vi = valueIndex.get(vk);
      if (vi === undefined) {
        vi = values.push(v) - 1;
        valueIndex.set(vk, vi);
      }
      tags.push(ki, vi);
    }
    return bytes(2, [
      ...packed(2, tags),
      ...key(3, 0),
      ...varint(3),
      ...packed(4, ringCommands(f.rings)),
    ]);
  });
  return bytes(3, [
    ...key(15, 0),
    ...varint(2),
    ...str(1, name),
    ...body,
    ...keys.flatMap((k) => str(3, k)),
    ...values.flatMap((v) => bytes(4, value(v))),
    ...key(5, 0),
    ...varint(EXTENT),
  ]);
}

// --- The town ----------------------------------------------------------------------------------
const rect = (cx, cy, w, d, turnDeg = 0) => {
  const a = (turnDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};

/** The town's buildings and land cover, in metres east and north of its centre. */
export function syntheticTown() {
  const buildings = [];
  // The street: nine houses a side, each its own height and a little off square to the road.
  for (let i = 0; i < 9; i++) {
    const north = -72 + 18 * i;
    buildings.push({
      name: `house-w${i}`,
      rings: [rect(-16, north, 9, 12, (i % 3) - 1)],
      properties: { render_height: 5.5 + (i % 4) * 0.8, render_min_height: 0 },
    });
    buildings.push({
      name: `house-e${i}`,
      rings: [rect(16, north + 3, 9, 12, 1 - (i % 3))],
      properties:
        i === 4
          ? { render_height: 7, render_min_height: 0, colour: '#8b4a3a' }
          : { render_height: 6 + ((i * 3) % 5) * 0.6, render_min_height: 0 },
    });
  }
  // No height mapped: the layer's default. And one the map says not to draw in 3D.
  buildings.push({ name: 'shed', rings: [rect(-40, -60, 8, 8)], properties: {} });
  buildings.push({
    name: 'hidden',
    rings: [rect(-40, -20, 14, 14)],
    properties: { render_height: 40, hide_3d: true },
  });
  // Mid-rise blocks north of the houses.
  buildings.push({
    name: 'block-a',
    rings: [rect(-34, 130, 24, 40)],
    properties: { render_height: 18, render_min_height: 0 },
  });
  buildings.push({
    name: 'block-b',
    rings: [rect(34, 135, 24, 44)],
    properties: { render_height: 27, render_min_height: 0 },
  });
  buildings.push({
    name: 'block-l',
    rings: [
      [
        [-90, 110],
        [-55, 110],
        [-55, 124],
        [-76, 124],
        [-76, 160],
        [-90, 160],
      ],
    ],
    properties: { render_height: 22, render_min_height: 0 },
  });
  buildings.push({
    name: 'courtyard',
    rings: [rect(80, 190, 50, 50), rect(80, 190, 26, 26)],
    properties: { render_height: 20, render_min_height: 0 },
  });
  // The towers: one with its own colour, one standing on a podium as a building part.
  buildings.push({
    name: 'tower',
    rings: [rect(-20, 240, 26, 26)],
    properties: { render_height: 70, render_min_height: 0 },
  });
  buildings.push({
    name: 'tower-blue',
    rings: [rect(30, 290, 30, 22)],
    properties: { render_height: 110, render_min_height: 0, colour: '#5a7a9a' },
  });
  buildings.push({
    name: 'podium',
    rings: [rect(-80, 260, 40, 40)],
    properties: { render_height: 12, render_min_height: 0 },
  });
  buildings.push({
    name: 'podium-tower',
    rings: [rect(-80, 260, 20, 20)],
    properties: { render_height: 60, render_min_height: 12 },
  });
  const landcover = [
    {
      name: 'forest',
      rings: [
        [
          [60, -130],
          [230, -130],
          [250, 20],
          [150, 70],
          [60, 50],
        ],
        rect(150, -40, 40, 30),
      ],
      properties: { class: 'wood', subclass: 'forest' },
    },
    {
      name: 'park',
      rings: [rect(-110, 0, 110, 130)],
      properties: { class: 'grass', subclass: 'park' },
    },
    // Not trees: farmland is land cover the layer leaves alone.
    {
      name: 'farm',
      rings: [rect(-220, 200, 120, 120)],
      properties: { class: 'farmland', subclass: 'farmland' },
    },
  ];
  return { buildings, landcover };
}

/**
 * Places to probe, in metres east and north of the centre, with the height of what should stand
 * there (null: nothing) and how near a reading must come (`tolM`, 1.5 m unless given).
 */
export const TOWN_PROBES = {
  tower: { east: -20, north: 240, heightM: 70 },
  towerBlue: { east: 30, north: 290, heightM: 110 },
  podiumTower: { east: -80, north: 260, heightM: 60 },
  podium: { east: -66, north: 246, heightM: 12 },
  house: { east: -16, north: 0, heightM: 5.5 },
  shed: { east: -40, north: -60, heightM: 6 },
  hidden: { east: -40, north: -20, heightM: null },
  courtyard: { east: 80, north: 190, heightM: null },
  street: { east: 0, north: 0, heightM: null },
};

const mercY = (latDeg) => {
  const s = Math.sin((latDeg * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/** One z14 tile of the town round `centre` ({ longitude, latitude }), or null if it is empty. */
export function townTile(centre, x, y) {
  const n = 2 ** Z;
  const mLat = 1 / 111320;
  const mLon = mLat / Math.cos((centre.latitude * Math.PI) / 180);
  const toTile = ([east, north]) => [
    Math.round((((centre.longitude + east * mLon + 180) / 360) * n - x) * EXTENT),
    Math.round((mercY(centre.latitude + north * mLat) * n - y) * EXTENT),
  ];
  const inTile = (ring) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of ring) {
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    return maxX >= -BUFFER && minX <= EXTENT + BUFFER && maxY >= -BUFFER && minY <= EXTENT + BUFFER;
  };
  const town = syntheticTown();
  const place = (features) =>
    features
      .map((f) => ({ rings: f.rings.map((r) => r.map(toTile)), properties: f.properties }))
      .filter((f) => inTile(f.rings[0]));
  const buildings = place(town.buildings);
  const landcover = place(town.landcover);
  if (buildings.length === 0 && landcover.length === 0) return null;
  return new Uint8Array([...layer('building', buildings), ...layer('landcover', landcover)]);
}

/**
 * Answers `fetch` for the town's TileJSON and tiles. Returns the TileJSON's URL, the tiles asked
 * for so far, and `restore` to put the page's own `fetch` back.
 */
export function installSyntheticTown(centre) {
  const real = window.fetch;
  const base = location.origin + '/synthetic-town';
  const asked = [];
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (!url.startsWith(base + '/')) return real.call(window, input, init);
    if (url === base + '/tiles.json')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            tilejson: '2.2.0',
            tiles: [base + '/{z}/{x}/{y}.pbf'],
            minzoom: Z,
            maxzoom: Z,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    const m = /\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url);
    if (!m || Number(m[1]) !== Z) return Promise.resolve(new Response(null, { status: 404 }));
    const tile = townTile(centre, Number(m[2]), Number(m[3]));
    asked.push({ x: Number(m[2]), y: Number(m[3]), bytes: tile ? tile.length : 0 });
    // Open country, as a tile server answers for a tile it has nothing in.
    if (!tile) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(
      new Response(tile, { status: 200, headers: { 'Content-Type': 'application/x-protobuf' } }),
    );
  };
  return {
    url: base + '/tiles.json',
    asked,
    restore: () => {
      window.fetch = real;
    },
  };
}

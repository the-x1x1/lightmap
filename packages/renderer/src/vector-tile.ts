/**
 * A small Mapbox Vector Tile (MVT 2.1) reader: the layers, their features, tags and geometry, and
 * nothing else. Enough for the OpenMapTiles layers the renderer reads (buildings first), without
 * a protobuf dependency. https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */

export type VectorValue = string | number | boolean;

export interface VectorFeature {
  /** 1 point, 2 line string, 3 polygon (0 unknown). */
  type: number;
  properties: Record<string, VectorValue>;
  /** Rings or lines in tile coordinates (0..extent, y down), each a flat [x0, y0, x1, y1, ...]. */
  geometry: number[][];
}

export interface VectorLayer {
  name: string;
  extent: number;
  features: VectorFeature[];
}

class Reader {
  pos = 0;
  readonly buf: Uint8Array;
  readonly end: number;
  constructor(buf: Uint8Array, end = buf.length) {
    this.buf = buf;
    this.end = end;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new Error('vector tile: truncated varint');
      const b = this.buf[this.pos++] as number;
      // Past 2^53 the value is not representable anyway; ids and lengths never get there.
      result += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return result;
      shift += 7;
      if (shift > 63) throw new Error('vector tile: varint too long');
    }
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`vector tile: unsupported wire type ${wire}`);
  }
  sub(): Reader {
    const len = this.varint();
    const r = new Reader(this.buf, this.pos + len);
    r.pos = this.pos;
    this.pos += len;
    return r;
  }
  string(): string {
    const r = this.sub();
    return new TextDecoder().decode(this.buf.subarray(r.pos, r.end));
  }
  packed(): number[] {
    const r = this.sub();
    const out: number[] = [];
    while (r.pos < r.end) out.push(r.varint());
    return out;
  }
}

const zigzag = (n: number): number => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function readValue(r: Reader): VectorValue | null {
  let v: VectorValue | null = null;
  const view = new DataView(r.buf.buffer, r.buf.byteOffset, r.buf.byteLength);
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1 && wire === 2) v = r.string();
    else if (field === 2 && wire === 5) {
      v = view.getFloat32(r.pos, true);
      r.pos += 4;
    } else if (field === 3 && wire === 1) {
      v = view.getFloat64(r.pos, true);
      r.pos += 8;
    } else if ((field === 4 || field === 5) && wire === 0) v = r.varint();
    else if (field === 6 && wire === 0) v = zigzag(r.varint());
    else if (field === 7 && wire === 0) v = r.varint() !== 0;
    else r.skip(wire);
  }
  return v;
}

/** Decodes MVT geometry commands into rings/lines (tile coordinates, absolute). */
export function decodeGeometry(commands: readonly number[]): number[][] {
  const out: number[][] = [];
  let cur: number[] | null = null;
  let x = 0;
  let y = 0;
  let i = 0;
  while (i < commands.length) {
    const cmd = commands[i++] as number;
    const id = cmd & 7;
    const count = cmd >>> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < count && i + 2 <= commands.length; k++) {
        x += zigzag(commands[i++] as number);
        y += zigzag(commands[i++] as number);
        if (id === 1) {
          cur = [];
          out.push(cur);
        }
        cur?.push(x, y);
      }
    } else if (id === 7) {
      // ClosePath: rings are closed implicitly; nothing to add.
    } else {
      throw new Error(`vector tile: unknown geometry command ${id}`);
    }
  }
  return out;
}

function readFeature(r: Reader, keys: string[], values: (VectorValue | null)[]): VectorFeature {
  let type = 0;
  let tags: number[] = [];
  let geom: number[] = [];
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 2 && wire === 2) tags = r.packed();
    else if (field === 3 && wire === 0) type = r.varint();
    else if (field === 4 && wire === 2) geom = r.packed();
    else r.skip(wire);
  }
  const properties: Record<string, VectorValue> = {};
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const k = keys[tags[i] as number];
    const v = values[tags[i + 1] as number];
    if (k !== undefined && v !== undefined && v !== null) properties[k] = v;
  }
  return { type, properties, geometry: decodeGeometry(geom) };
}

function readLayer(r: Reader, wanted: ReadonlySet<string> | null): VectorLayer | null {
  // Keys and values come after the features in practice, so features are kept raw until the end.
  let name = '';
  let extent = 4096;
  const keys: string[] = [];
  const values: (VectorValue | null)[] = [];
  const raw: Reader[] = [];
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1 && wire === 2) name = r.string();
    else if (field === 2 && wire === 2) raw.push(r.sub());
    else if (field === 3 && wire === 2) keys.push(r.string());
    else if (field === 4 && wire === 2) values.push(readValue(r.sub()));
    else if (field === 5 && wire === 0) extent = r.varint();
    else r.skip(wire);
  }
  if (wanted && !wanted.has(name)) return null;
  return { name, extent, features: raw.map((f) => readFeature(f, keys, values)) };
}

/** The layers of a tile, or only those named in `only`. */
export function readVectorTile(
  data: Uint8Array,
  only?: readonly string[],
): Record<string, VectorLayer> {
  const wanted = only ? new Set(only) : null;
  const r = new Reader(data);
  const layers: Record<string, VectorLayer> = {};
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 3 && wire === 2) {
      const layer = readLayer(r.sub(), wanted);
      if (layer) layers[layer.name] = layer;
    } else r.skip(wire);
  }
  return layers;
}

/** Twice the signed area of a ring (the MVT "surveyor's formula"; > 0 is an exterior ring). */
export function ringArea2(ring: readonly number[]): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (ring[2 * i] as number) * (ring[2 * j + 1] as number);
    a -= (ring[2 * j] as number) * (ring[2 * i + 1] as number);
  }
  return a;
}

/** Groups polygon rings into polygons: each exterior ring with the interior rings after it. */
export function classifyRings(
  rings: readonly number[][],
): { outer: number[]; holes: number[][] }[] {
  const out: { outer: number[]; holes: number[][] }[] = [];
  for (const ring of rings) {
    if (ring.length < 6) continue;
    const a = ringArea2(ring);
    if (a > 0) out.push({ outer: ring, holes: [] });
    else if (a < 0) out[out.length - 1]?.holes.push(ring);
  }
  return out;
}

/** Sutherland–Hodgman clip of a ring to the square [lo, hi]² (vector tiles carry a buffer). */
export function clipRing(ring: readonly number[], lo: number, hi: number): number[] {
  let pts = ring.slice();
  const edges: [number, number, boolean][] = [
    [0, lo, true],
    [0, hi, false],
    [1, lo, true],
    [1, hi, false],
  ];
  for (const [axis, bound, isMin] of edges) {
    const n = pts.length / 2;
    if (n === 0) break;
    const next: number[] = [];
    const inside = (i: number) =>
      isMin ? (pts[2 * i + axis] as number) >= bound : (pts[2 * i + axis] as number) <= bound;
    for (let i = 0; i < n; i++) {
      const j = (i + n - 1) % n;
      const ci = inside(i);
      const cj = inside(j);
      if (ci !== cj) {
        const ax = pts[2 * j] as number;
        const ay = pts[2 * j + 1] as number;
        const bx = pts[2 * i] as number;
        const by = pts[2 * i + 1] as number;
        const t =
          (bound - (axis === 0 ? ax : ay)) / ((axis === 0 ? bx : by) - (axis === 0 ? ax : ay));
        next.push(ax + t * (bx - ax), ay + t * (by - ay));
      }
      if (ci) next.push(pts[2 * i] as number, pts[2 * i + 1] as number);
    }
    pts = next;
  }
  return pts;
}

/** Tile coordinates → longitude/latitude (Web Mercator, XYZ tile scheme). */
export function tilePointToLonLat(
  z: number,
  tx: number,
  ty: number,
  extent: number,
  px: number,
  py: number,
): [number, number] {
  const n = 2 ** z;
  const lon = ((tx + px / extent) / n) * 360 - 180;
  const yMerc = Math.PI * (1 - (2 * (ty + py / extent)) / n);
  const lat = (Math.atan(Math.sinh(yMerc)) * 180) / Math.PI;
  return [lon, lat];
}

/** The XYZ tile containing a point. */
export function lonLatToTile(z: number, lon: number, lat: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

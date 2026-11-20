/**
 * Hipped roofs for houses.
 *
 * OpenStreetMap maps a building's outline and, at best, its height; hardly ever the shape of its
 * roof. Extruded as mapped, a street of houses is a row of flat-topped boxes, which no street of
 * houses is. Where a footprint is plainly a house - a low, simple rectangle - this gives it the
 * commonest roof there is: slopes rising from all four eaves at the same pitch to a ridge along
 * the middle (a hip roof; a pyramid on a square), the eaves standing a little out from the walls.
 * The mapped height stays the building's top: the ridge is at it and the eaves come down, so
 * nothing stands taller than the map said.
 *
 * A guess, like the glazing: the map does not say that this house has a hip roof rather than a
 * gable, a mansard or a flat one, nor which way its ridge runs. Larger, taller or odd-shaped
 * buildings (halls, blocks, anything with a courtyard or a part set on another) are left flat.
 *
 * Pure geometry, no Cesium: the layer turns the mesh into a primitive.
 */
import type { BuildingFootprint } from './osm-buildings.ts';

/** The roofs' pitch. */
export const ROOF_PITCH_DEG = 30;
/** The least wall left under the eaves, metres: a storey's worth. */
export const MIN_EAVE_M = 2.4;
/** A roof rising less than this is not worth drawing. */
export const MIN_RISE_M = 0.9;
/** How far the eaves stand out from the walls, metres. */
export const EAVE_OVERHANG_M = 0.35;
/** The houses that get a roof: their height, their narrow side and their length, metres. */
export const HOUSE_HEIGHT_M: readonly [number, number] = [3.5, 13];
export const HOUSE_WIDTH_M: readonly [number, number] = [3.5, 14];
export const HOUSE_MAX_LENGTH_M = 30;

type LonLat = [number, number];
type XY = [number, number];

export interface HipRoof {
  /** The walls' corners, counter-clockwise seen from above; the first side is a long one. */
  corners: [LonLat, LonLat, LonLat, LonLat];
  /** The eaves' corners, corner for corner: out from the walls by the overhang on both sides. */
  eaves: [LonLat, LonLat, LonLat, LonLat];
  /** How far the eaves' edge hangs below the top of the walls: the slope carried on outward. */
  dropM: number;
  /** The ridge's ends, over the house's long middle line; one point twice on a square. */
  ridge: [LonLat, LonLat];
  /** Metres from the top of the walls up to the ridge. */
  riseM: number;
}

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const len = (a: XY): number => Math.hypot(a[0], a[1]);
const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Twice the ring's area, positive when it runs counter-clockwise (x east, y north). */
function area2(ring: readonly XY[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as XY;
    const q = ring[(i + 1) % ring.length] as XY;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/** The ring without repeated points and without vertices on a straight run (within 10 deg). */
function corners(ring: readonly XY[]): XY[] {
  let pts = ring.slice();
  for (let changed = true; changed && pts.length >= 3;) {
    changed = false;
    const out: XY[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = (out.length > 0 ? out[out.length - 1] : pts[pts.length - 1]) as XY;
      const here = pts[i] as XY;
      const next = pts[(i + 1) % pts.length] as XY;
      const a = sub(here, prev);
      const b = sub(next, here);
      const la = len(a);
      const lb = len(b);
      // A repeated point, or one the outline runs straight through.
      if (la < 0.3 || lb < 1e-9 || (a[0] * b[0] + a[1] * b[1]) / (la * lb) > 0.985) {
        changed = true;
        continue;
      }
      out.push(here);
    }
    pts = out;
  }
  return pts;
}

/**
 * The hip roof a footprint takes, or null where it is not a house: anything with a hole or set
 * on another part, taller or lower than a house, not four-cornered and square-angled (within
 * 15 deg), wider or longer than a house, or a piece cut off by its tile's edge.
 */
export function hipRoofFor(
  b: Pick<BuildingFootprint, 'outer' | 'holes' | 'heightM' | 'minHeightM' | 'centre'> &
    Pick<Partial<BuildingFootprint>, 'atTileEdge'>,
): HipRoof | null {
  if (b.holes.length > 0 || b.minHeightM > 0) return null;
  // One piece of a house its tile cut in two: each piece would get a roof of its own, two
  // ridges on one house along every tile edge. Both pieces keep the flat top, at one height.
  if (b.atTileEdge) return null;
  if (!(b.heightM >= HOUSE_HEIGHT_M[0] && b.heightM <= HOUSE_HEIGHT_M[1])) return null;
  const [lon0, lat0] = b.centre;
  const ky = 111_320;
  const kx = ky * Math.cos((lat0 * Math.PI) / 180);
  if (!(kx > 1)) return null;
  const pts = corners(b.outer.map(([lon, lat]): XY => [(lon - lon0) * kx, (lat - lat0) * ky]));
  if (pts.length !== 4) return null;
  if (area2(pts) < 0) pts.reverse();
  const side = (i: number): XY => sub(pts[(i + 1) % 4] as XY, pts[i % 4] as XY);
  const sides = [0, 1, 2, 3].map((i) => len(side(i)));
  for (let i = 0; i < 4; i++) {
    const a = side(i);
    const c = side(i + 1);
    const la = sides[i] as number;
    const lc = sides[(i + 1) % 4] as number;
    // Convex, and each corner within 15 deg of square.
    if (a[0] * c[1] - a[1] * c[0] <= 0) return null;
    if (Math.abs(a[0] * c[0] + a[1] * c[1]) / (la * lc) > 0.2588) return null;
  }
  const [s0, s1, s2, s3] = sides as [number, number, number, number];
  if (Math.abs(s0 - s2) > 0.2 * Math.max(s0, s2)) return null;
  if (Math.abs(s1 - s3) > 0.2 * Math.max(s1, s3)) return null;
  const a = (s0 + s2) / 2;
  const c = (s1 + s3) / 2;
  const long = Math.max(a, c);
  const short = Math.min(a, c);
  if (short < HOUSE_WIDTH_M[0] || short > HOUSE_WIDTH_M[1] || long > HOUSE_MAX_LENGTH_M)
    return null;
  const riseM = Math.min(
    (short / 2) * Math.tan((ROOF_PITCH_DEG * Math.PI) / 180),
    b.heightM - MIN_EAVE_M,
  );
  if (riseM < MIN_RISE_M) return null;
  // From a long side: A-B long, B-C short, C-D long, D-A short.
  const first = a >= c ? 0 : 1;
  const P = [0, 1, 2, 3].map((i) => pts[(first + i) % 4] as XY) as [XY, XY, XY, XY];
  // The ridge along the long middle line, drawn in from each end by half the width, so the
  // hips at the ends rise at the slopes' own pitch.
  const m1 = mid(P[3], P[0]);
  const m2 = mid(P[1], P[2]);
  const d = sub(m2, m1);
  const run = len(d);
  const inset = Math.min(short / 2, run / 2);
  const u: XY = run > 0 ? [d[0] / run, d[1] / run] : [0, 0];
  const r1: XY = [m1[0] + u[0] * inset, m1[1] + u[1] * inset];
  const r2: XY = [m2[0] - u[0] * inset, m2[1] - u[1] * inset];
  // The eaves: each corner out along both of its walls by the overhang (the outline runs
  // counter-clockwise, so "out" from a side is to its right).
  const out = (i: number): XY => {
    const a = sub(P[i] as XY, P[(i + 3) % 4] as XY);
    const c = sub(P[(i + 1) % 4] as XY, P[i] as XY);
    const la = len(a);
    const lc = len(c);
    const p = P[i] as XY;
    return [
      p[0] + EAVE_OVERHANG_M * (a[1] / la + c[1] / lc),
      p[1] - EAVE_OVERHANG_M * (a[0] / la + c[0] / lc),
    ];
  };
  const back = ([x, y]: XY): LonLat => [lon0 + x / kx, lat0 + y / ky];
  return {
    corners: [back(P[0]), back(P[1]), back(P[2]), back(P[3])],
    eaves: [back(out(0)), back(out(1)), back(out(2)), back(out(3))],
    dropM: (EAVE_OVERHANG_M * riseM) / (short / 2),
    ridge: [back(r1), back(r2)],
    riseM,
  };
}

/** Vertices one roof adds to a mesh, and the triangles over them (to be offset by its first). */
export const HIP_ROOF_VERTICES = 28;
const TOP_INDICES = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13];
export const HIP_ROOF_INDICES: readonly number[] = [
  ...TOP_INDICES,
  // The underside: the same triangles turned over, on vertices of their own.
  ...TOP_INDICES.map((_, i) => 14 + (TOP_INDICES[i - (i % 3) + (2 - (i % 3))] as number)),
];

/**
 * Appends a roof's faces to `positions` and `normals` (three numbers a vertex), flat-shaded:
 * the two long slopes (four vertices each), then the two hips (three each), every face wound
 * counter-clockwise seen from outside - and then the same faces again turned over, looking
 * down, for the underside of the eaves (seen from the street; the rest of it is indoors).
 * The faces run from the ridge out to the eaves' edge, past the walls and a little below their
 * top. `wallTopM` is the height of the top of the walls and `toWorld` places a point: [lon, lat]
 * and a height to the mesh's own coordinates.
 */
export function hipRoofMesh(
  roof: HipRoof,
  wallTopM: number,
  toWorld: (lon: number, lat: number, heightM: number) => [number, number, number],
  positions: number[],
  normals: number[],
): void {
  const edge = wallTopM - roof.dropM;
  const [A, B, C, D] = roof.eaves.map(([lon, lat]) => toWorld(lon, lat, edge)) as [V3, V3, V3, V3];
  const top = wallTopM + roof.riseM;
  const R1 = toWorld(roof.ridge[0][0], roof.ridge[0][1], top);
  const R2 = toWorld(roof.ridge[1][0], roof.ridge[1][1], top);
  const faces = [
    [A, B, R2, R1],
    [C, D, R1, R2],
    [D, A, R1],
    [B, C, R2],
  ] as V3[][];
  for (const side of [1, -1])
    for (const face of faces) {
      const [p, q, r] = face as [V3, V3, V3];
      const ux = q[0] - p[0];
      const uy = q[1] - p[1];
      const uz = q[2] - p[2];
      const vx = r[0] - p[0];
      const vy = r[1] - p[1];
      const vz = r[2] - p[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const n = (Math.hypot(nx, ny, nz) || 1) * side;
      nx /= n;
      ny /= n;
      nz /= n;
      for (const v of face) {
        positions.push(v[0], v[1], v[2]);
        normals.push(nx, ny, nz);
      }
    }
}

type V3 = [number, number, number];

/** The triangles of `roofs` roofs meshed one after another: 16-bit while their vertices fit. */
export function hipRoofIndices(roofs: number): Uint16Array | Uint32Array {
  const n = Math.max(0, Math.floor(roofs));
  const per = HIP_ROOF_INDICES.length;
  const out = n * HIP_ROOF_VERTICES > 65535 ? new Uint32Array(n * per) : new Uint16Array(n * per);
  for (let r = 0; r < n; r++)
    for (let j = 0; j < per; j++)
      out[r * per + j] = r * HIP_ROOF_VERTICES + (HIP_ROOF_INDICES[j] as number);
  return out;
}

/**
 * Roofing for the houses, as the buildings' colours are given: slates and shingles in greys and
 * browns, one muted clay. Which a house takes is its own (`roofShade`), not its region's - the
 * map has no roof colours to speak of, and tile colours are regional.
 */
export const HOUSE_ROOFS: readonly (readonly [number, number, number])[] = [
  [0.36, 0.36, 0.38], // slate
  [0.3, 0.3, 0.31], // dark shingle
  [0.42, 0.4, 0.37], // weathered grey
  [0.4, 0.31, 0.25], // brown shingle
  [0.47, 0.3, 0.23], // clay tile
  [0.33, 0.27, 0.24], // dark brown
];

/** Which roofing a house takes: an index into `HOUSE_ROOFS`, from where it stands. */
export function roofShade(centre: readonly [number, number]): number {
  const h = Math.abs(Math.sin(centre[0] * 12.9898 + centre[1] * 78.233) * 43758.5453) % 1;
  const k = Math.floor(((h * 5.71) % 1) * HOUSE_ROOFS.length);
  return Number.isFinite(k) ? Math.min(HOUSE_ROOFS.length - 1, Math.max(0, k)) : 0;
}

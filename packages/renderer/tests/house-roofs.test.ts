import { describe, expect, it } from 'vitest';
import {
  EAVE_OVERHANG_M,
  HIP_ROOF_INDICES,
  HIP_ROOF_VERTICES,
  HOUSE_ROOFS,
  MIN_EAVE_M,
  ROOF_PITCH_DEG,
  hipRoofFor,
  hipRoofIndices,
  hipRoofMesh,
  roofShade,
} from '../src/house-roofs.ts';

const LAT = 48;
const KY = 111_320;
const KX = KY * Math.cos((LAT * Math.PI) / 180);
/** A footprint from corners in metres east and north of [10, LAT]. */
const footprint = (
  metres: [number, number][],
  heightM: number,
  extra: { holes?: [number, number][][]; minHeightM?: number } = {},
) => ({
  outer: metres.map(([x, y]): [number, number] => [10 + x / KX, LAT + y / KY]),
  holes: extra.holes ?? [],
  heightM,
  minHeightM: extra.minHeightM ?? 0,
  centre: [10, LAT] as [number, number],
});
const rect = (w: number, d: number, turnDeg = 0): [number, number][] => {
  const a = (turnDeg * Math.PI) / 180;
  return (
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as [number, number][]
  ).map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
};
const metres = ([lon, lat]: [number, number]): [number, number] => [
  (lon - 10) * KX,
  (lat - LAT) * KY,
];
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** The mesh in local metres: x east, y north, z up. */
const local = (lon: number, lat: number, h: number): [number, number, number] => [
  (lon - 10) * KX,
  (lat - LAT) * KY,
  h,
];

describe('hip roofs for houses', () => {
  it('gives a plain house a ridge along its length, at 30 deg from every eave', () => {
    const roof = hipRoofFor(footprint(rect(8, 12, 20), 7));
    expect(roof).not.toBeNull();
    if (!roof) return;
    const c = roof.corners.map(metres);
    // Counter-clockwise, the first side a long one.
    expect(dist(c[0]!, c[1]!)).toBeCloseTo(12, 3);
    expect(dist(c[1]!, c[2]!)).toBeCloseTo(8, 3);
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const p = c[i]!;
      const q = c[(i + 1) % 4]!;
      area += p[0] * q[1] - q[0] * p[1];
    }
    expect(area / 2).toBeCloseTo(96, 2);
    // The ridge: centred, the length less the width, half the width in from each end.
    const [r1, r2] = roof.ridge.map(metres) as [[number, number], [number, number]];
    expect(dist(r1, r2)).toBeCloseTo(4, 3);
    expect((r1[0] + r2[0]) / 2).toBeCloseTo(0, 3);
    expect((r1[1] + r2[1]) / 2).toBeCloseTo(0, 3);
    expect(roof.riseM).toBeCloseTo(4 * Math.tan((ROOF_PITCH_DEG * Math.PI) / 180), 6);
    // The eaves: the walls' rectangle grown by the overhang on every side, corner for corner,
    // their edge as far below the walls' top as the slope falls over the overhang.
    const e = roof.eaves.map(metres);
    expect(dist(e[0]!, e[1]!)).toBeCloseTo(12 + 2 * EAVE_OVERHANG_M, 3);
    expect(dist(e[1]!, e[2]!)).toBeCloseTo(8 + 2 * EAVE_OVERHANG_M, 3);
    for (let i = 0; i < 4; i++) {
      expect(dist(e[i]!, c[i]!)).toBeCloseTo(EAVE_OVERHANG_M * Math.SQRT2, 3);
      expect(Math.hypot(...e[i]!)).toBeGreaterThan(Math.hypot(...c[i]!));
    }
    expect(roof.dropM).toBeCloseTo(EAVE_OVERHANG_M * Math.tan((ROOF_PITCH_DEG * Math.PI) / 180), 6);
  });

  it('keeps a storey of wall under the eaves, and leaves a house too low for a roof flat', () => {
    // 4.2 m to the ridge: the eaves stay at 2.4 m and the roof takes what is left.
    expect(hipRoofFor(footprint(rect(8, 12), 4.2))?.riseM).toBeCloseTo(4.2 - MIN_EAVE_M, 6);
    // 3.5 m: only 1.1 m would be left - still a roof; at 3.2 m the building is no house.
    expect(hipRoofFor(footprint(rect(8, 12), 3.5))?.riseM).toBeCloseTo(1.1, 6);
    expect(hipRoofFor(footprint(rect(8, 12), 3.2))).toBeNull();
    // A narrow shed: half of 3.6 m at 30 deg is a metre of roof.
    expect(hipRoofFor(footprint(rect(3.6, 6), 5))?.riseM).toBeCloseTo(1.039, 3);
  });

  it('is a pyramid on a square', () => {
    const roof = hipRoofFor(footprint(rect(9, 9), 8));
    expect(roof).not.toBeNull();
    if (!roof) return;
    const [r1, r2] = roof.ridge.map(metres) as [[number, number], [number, number]];
    expect(dist(r1, r2)).toBeLessThan(1e-6);
    expect(Math.hypot(r1[0], r1[1])).toBeLessThan(1e-6);
  });

  it('reads through a clockwise outline, a repeated point and a point on a straight wall', () => {
    const plain = hipRoofFor(footprint(rect(8, 12), 7));
    const clockwise = hipRoofFor(footprint(rect(8, 12).reverse(), 7));
    expect(clockwise?.riseM).toBeCloseTo(plain?.riseM ?? 0, 9);
    const r = rect(8, 12);
    const extra: [number, number][] = [r[0]!, [0, -6], r[1]!, r[1]!, r[2]!, r[3]!];
    const roof = hipRoofFor(footprint(extra, 7));
    expect(roof?.riseM).toBeCloseTo(plain?.riseM ?? 0, 9);
    expect(roof?.corners.map(metres).map(([x, y]) => [Math.abs(x), Math.abs(y)])).toEqual(
      plain?.corners.map(metres).map(([x, y]) => [Math.abs(x), Math.abs(y)]),
    );
  });

  it('leaves everything that is not plainly a house flat', () => {
    // Too tall, a part set on another, a courtyard.
    expect(hipRoofFor(footprint(rect(8, 12), 13.5))).toBeNull();
    expect(hipRoofFor(footprint(rect(8, 12), 9, { minHeightM: 3 }))).toBeNull();
    expect(hipRoofFor(footprint(rect(12, 12), 7, { holes: [[]] }))).toBeNull();
    // A hall, a long shed, a hut.
    expect(hipRoofFor(footprint(rect(16, 24), 8))).toBeNull();
    expect(hipRoofFor(footprint(rect(8, 34), 6))).toBeNull();
    expect(hipRoofFor(footprint(rect(3, 4), 5))).toBeNull();
    // An L, a triangle, a lozenge, a kite whose sides do not match.
    const L: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 5],
      [5, 5],
      [5, 10],
      [0, 10],
    ];
    expect(hipRoofFor(footprint(L, 7))).toBeNull();
    expect(
      hipRoofFor(
        footprint(
          [
            [0, 0],
            [10, 0],
            [5, 9],
          ],
          7,
        ),
      ),
    ).toBeNull();
    expect(
      hipRoofFor(
        footprint(
          [
            [0, 0],
            [10, 0],
            [14, 8],
            [4, 8],
          ],
          7,
        ),
      ),
    ).toBeNull();
    expect(
      hipRoofFor(
        footprint(
          [
            [0, 0],
            [10, 0],
            [10.5, 6],
            [0.5, 11],
          ],
          7,
        ),
      ),
    ).toBeNull();
    // A house a little off square (a few degrees, as surveyed) still gets its roof.
    expect(
      hipRoofFor(
        footprint(
          [
            [0, 0],
            [12, 0.4],
            [11.6, 8.3],
            [-0.3, 8],
          ],
          7,
        ),
      ),
    ).not.toBeNull();
    // Nothing sensible at the poles' own latitude or from numbers that are not numbers.
    expect(hipRoofFor({ ...footprint(rect(8, 12), 7), centre: [10, 90] })).toBeNull();
    expect(hipRoofFor(footprint(rect(8, 12), Number.NaN))).toBeNull();
  });

  it('meshes four faces that look up and outward at the pitch, and their underside', () => {
    const roof = hipRoofFor(footprint(rect(8, 12, 35), 7));
    expect(roof).not.toBeNull();
    if (!roof) return;
    const positions: number[] = [];
    const normals: number[] = [];
    const wallTop = 100 + 7 - roof.riseM;
    hipRoofMesh(roof, wallTop, local, positions, normals);
    expect(positions.length).toBe(HIP_ROOF_VERTICES * 3);
    expect(normals.length).toBe(HIP_ROOF_VERTICES * 3);
    expect(HIP_ROOF_VERTICES).toBe(28);
    expect(Math.max(...HIP_ROOF_INDICES)).toBe(HIP_ROOF_VERTICES - 1);
    expect(HIP_ROOF_INDICES.length).toBe(36);
    // Every vertex is at the eaves' edge or on the ridge; the ridge is the mapped height.
    const edge = wallTop - roof.dropM;
    for (let i = 0; i < HIP_ROOF_VERTICES; i++) {
      const z = positions[3 * i + 2]!;
      expect(Math.min(Math.abs(z - edge), Math.abs(z - 107))).toBeLessThan(1e-9);
    }
    // The slopes pass through the top of the walls where they cross them: 0.35 m in from the
    // eaves' edge a slope has risen by the drop.
    expect(roof.dropM / EAVE_OVERHANG_M).toBeCloseTo(roof.riseM / 4, 9);
    // Every face: a unit normal, 30 deg from the vertical - up on top, down underneath.
    const up = Math.cos((ROOF_PITCH_DEG * Math.PI) / 180);
    for (let i = 0; i < HIP_ROOF_VERTICES; i++) {
      const [nx, ny, nz] = [normals[3 * i]!, normals[3 * i + 1]!, normals[3 * i + 2]!];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 9);
      expect(nz).toBeCloseTo(i < 14 ? up : -up, 6);
    }
    for (let t = 0; t < HIP_ROOF_INDICES.length; t += 3) {
      const [i, j, k] = [HIP_ROOF_INDICES[t]!, HIP_ROOF_INDICES[t + 1]!, HIP_ROOF_INDICES[t + 2]!];
      const top = t < 18;
      expect(Math.max(i, j, k) < 14).toBe(top);
      const cx = (positions[3 * i]! + positions[3 * j]! + positions[3 * k]!) / 3;
      const cy = (positions[3 * i + 1]! + positions[3 * j + 1]! + positions[3 * k + 1]!) / 3;
      // The triangle's own winding agrees with its stored normal: counter-clockwise from above
      // on top, from below underneath (none here is without area, as the second triangle of a
      // slope is on a pyramid).
      const ux = positions[3 * j]! - positions[3 * i]!;
      const uy = positions[3 * j + 1]! - positions[3 * i + 1]!;
      const vx = positions[3 * k]! - positions[3 * i]!;
      const vy = positions[3 * k + 1]! - positions[3 * i + 1]!;
      expect((ux * vy - uy * vx) * (top ? 1 : -1)).toBeGreaterThan(0);
      // Looking away from the middle on top, toward it underneath.
      expect((normals[3 * i]! * cx + normals[3 * i + 1]! * cy) * (top ? 1 : -1)).toBeGreaterThan(0);
    }
    // The underside is the top's own points again.
    for (let i = 0; i < 14 * 3; i++) expect(positions[14 * 3 + i]).toBe(positions[i]);
  });

  it('meshes a lower pitch where the wall under the eaves is kept', () => {
    const roof = hipRoofFor(footprint(rect(8, 12), 4.2));
    expect(roof).not.toBeNull();
    if (!roof) return;
    const positions: number[] = [];
    const normals: number[] = [];
    hipRoofMesh(roof, MIN_EAVE_M, local, positions, normals);
    const pitch = Math.atan2(4.2 - MIN_EAVE_M, 4);
    for (let i = 0; i < HIP_ROOF_VERTICES; i++)
      expect(normals[3 * i + 2]!).toBeCloseTo(i < 14 ? Math.cos(pitch) : -Math.cos(pitch), 6);
    expect(roof.dropM).toBeCloseTo(EAVE_OVERHANG_M * Math.tan(pitch), 6);
  });

  it('indexes roofs meshed one after another, in 16 bits while they fit', () => {
    expect(hipRoofIndices(0).length).toBe(0);
    const two = hipRoofIndices(2);
    expect(two).toBeInstanceOf(Uint16Array);
    expect([...two.slice(0, 36)]).toEqual([...HIP_ROOF_INDICES]);
    expect([...two.slice(36)]).toEqual(HIP_ROOF_INDICES.map((i) => i + HIP_ROOF_VERTICES));
    // 2,340 roofs are 65,520 vertices; one more needs 32 bits.
    expect(hipRoofIndices(2340)).toBeInstanceOf(Uint16Array);
    const many = hipRoofIndices(2341);
    expect(many).toBeInstanceOf(Uint32Array);
    expect(Math.max(...many.slice(-36))).toBe(2341 * HIP_ROOF_VERTICES - 1);
  });

  it('gives each house a roofing of its own, the same every time, all of them in use', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const centre: [number, number] = [10 + i * 0.00013, 48 + ((i * 7) % 50) * 0.0001];
      const k = roofShade(centre);
      expect(Number.isInteger(k) && k >= 0 && k < HOUSE_ROOFS.length).toBe(true);
      expect(roofShade(centre)).toBe(k);
      seen.add(k);
    }
    expect(seen.size).toBe(HOUSE_ROOFS.length);
    expect(roofShade([Number.NaN, 0])).toBe(0);
    // Roofing is dark and dull beside the walls: no channel over a half.
    for (const c of HOUSE_ROOFS) expect(Math.max(...c)).toBeLessThan(0.5);
  });
});

/**
 * The buildings layer's pitched roofs (`roofOf`, `describeBuilding`, `loadRoofs`) against a
 * stand-in for Cesium that keeps what it is given: the walls of a house stop at its eaves, its
 * roof is meshed into the primitive of its roofing, and everything else stays as it was.
 */
import { describe, expect, it } from 'vitest';
import { OsmBuildingsLayer, ROOF_ALPHA } from '../src/cesium/osm-buildings-layer.ts';
import { HIP_ROOF_VERTICES, HOUSE_ROOFS, hipRoofFor, roofShade } from '../src/house-roofs.ts';
import type { BuildingFootprint } from '../src/osm-buildings.ts';

const LAT = 48;
const KY = 111_320;
const KX = KY * Math.cos((LAT * Math.PI) / 180);

class FakePrimitive {
  show = true;
  ready = true;
  appearance: unknown;
  destroyed = false;
  options: {
    geometryInstances: {
      geometry: {
        attributes: { position: { values: Float64Array }; normal: { values: Float32Array } };
        indices: Uint16Array | Uint32Array;
        primitiveType: number;
        boundingSphere: { n: number };
      };
      attributes: { color: { r: number; g: number; b: number; alpha: number } };
    }[];
    asynchronous: boolean;
    shadows: number;
    allowPicking: boolean;
  };
  constructor(options: FakePrimitive['options'] & { appearance: unknown }) {
    this.options = options;
    this.appearance = options.appearance;
  }
  update(): void {}
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

class FakeCollection {
  items: FakePrimitive[] = [];
  add(p: FakePrimitive): FakePrimitive {
    this.items.push(p);
    return p;
  }
  remove(p: FakePrimitive): boolean {
    this.items = this.items.filter((q) => q !== p);
    p.destroyed = true;
    return true;
  }
}

class Keep {
  constructor(options?: object) {
    Object.assign(this, options);
  }
}

function setup(failPrimitive = false) {
  class Colour {
    r: number;
    g: number;
    b: number;
    alpha: number;
    constructor(r: number, g: number, b: number, alpha: number) {
      this.r = r;
      this.g = g;
      this.b = b;
      this.alpha = alpha;
    }
  }
  const C = {
    Primitive: failPrimitive
      ? class {
          constructor() {
            throw new Error('no primitive today');
          }
        }
      : FakePrimitive,
    PrimitiveCollection: FakeCollection,
    PerInstanceColorAppearance: class {
      static VERTEX_FORMAT = {};
    },
    ShadowMode: { ENABLED: 1 },
    Color: Colour,
    ColorGeometryInstanceAttribute: { fromColor: (c: Colour) => c },
    // A flat world: metres east and north of [10, LAT], and the height.
    Cartesian3: class {
      x = 0;
      y = 0;
      z = 0;
      static fromDegrees(
        lon: number,
        lat: number,
        h: number,
        _ellipsoid: undefined,
        result: { x: number; y: number; z: number },
      ) {
        result.x = (lon - 10) * KX;
        result.y = (lat - LAT) * KY;
        result.z = h;
        return result;
      }
      static fromDegreesArray(flat: number[]) {
        return flat;
      }
    },
    PolygonHierarchy: Keep,
    PolygonGeometry: Keep,
    GeometryAttributes: Keep,
    GeometryAttribute: Keep,
    Geometry: Keep,
    GeometryInstance: Keep,
    BoundingSphere: { fromVertices: (xs: number[]) => ({ n: xs.length }) },
    ComponentDatatype: { DOUBLE: 5130, FLOAT: 5126 },
    PrimitiveType: { TRIANGLES: 4 },
  };
  const top: FakeCollection[] = [];
  const scene = {
    primitives: { add: (c: FakeCollection) => top.push(c), remove: () => true },
    preRender: { addEventListener: () => () => {} },
    requestRender: () => {},
  };
  const errors: string[] = [];
  const layer = new OsmBuildingsLayer(C as never, scene as never, 'https://example.invalid', (m) =>
    errors.push(m),
  );
  const l = layer as unknown as {
    roofOf: (b: BuildingFootprint, g?: object) => { eaveM: number; plan: object } | null;
    describeBuilding: (
      b: BuildingFootprint,
      g?: object,
    ) => { description: { height: number; extrudedHeight: number }; colour: unknown } | null;
    loadRoofs: (state: unknown, buildings: BuildingFootprint[], grounds: object[]) => Promise<void>;
  };
  const state = {
    key: '1/1',
    x: 1,
    y: 1,
    primitives: [] as FakePrimitive[],
    cancelled: false,
    done: Promise.resolve(),
    near: true,
  };
  return { layer, l, state, collection: top[0] as FakeCollection, errors };
}

/** A footprint w by d metres centred `east` metres from [10, LAT]. */
const box = (east: number, w: number, d: number, heightM: number, minHeightM = 0) => {
  const lon0 = 10 + east / KX;
  const outer: [number, number][] = [
    [lon0 - w / 2 / KX, LAT - d / 2 / KY],
    [lon0 + w / 2 / KX, LAT - d / 2 / KY],
    [lon0 + w / 2 / KX, LAT + d / 2 / KY],
    [lon0 - w / 2 / KX, LAT + d / 2 / KY],
  ];
  return {
    outer,
    holes: [],
    heightM,
    minHeightM,
    colour: null,
    centre: [lon0, LAT],
  } as BuildingFootprint;
};

describe("the buildings layer's pitched roofs", () => {
  it("stops a house's walls at its eaves and leaves a block's at its top", () => {
    const { l } = setup();
    const house = box(0, 8, 12, 7);
    const ground = { centre: 100, low: 99.5, high: 100.4 };
    const rise = hipRoofFor(house)?.riseM ?? 0;
    expect(rise).toBeGreaterThan(2);
    expect(l.roofOf(house, ground)?.eaveM).toBeCloseTo(107 - rise, 9);
    const walls = l.describeBuilding(house, ground);
    expect(walls?.description.extrudedHeight).toBeCloseTo(107 - rise, 9);
    expect(walls?.description.height).toBeCloseTo(99.5 - 2, 9);
    // A block keeps its flat top where it was.
    const block = box(40, 24, 40, 18);
    expect(l.roofOf(block, ground)).toBeNull();
    expect(l.describeBuilding(block, ground)?.description.extrudedHeight).toBe(118);
    // No ground known: the ellipsoid.
    expect(l.roofOf(house, undefined)?.eaveM).toBeCloseTo(7 - rise, 9);
  });

  it('leaves a house flat where the hillside would stand above its eaves', () => {
    const { l } = setup();
    const house = box(0, 8, 12, 5);
    // Level ground: eaves 2.69 m up.
    expect(l.roofOf(house, { centre: 100, low: 100, high: 100 })).not.toBeNull();
    // The ground at the highest corner 1.5 m above the centre's: 1.2 m of wall there - no roof.
    const steep = { centre: 100, low: 98.5, high: 101.5 };
    expect(l.roofOf(house, steep)).toBeNull();
    expect(l.describeBuilding(house, steep)?.description.extrudedHeight).toBe(105);
  });

  it('meshes every roof of a tile into one primitive, an instance a roofing', async () => {
    const { layer, l, state, collection } = setup();
    const houses = Array.from({ length: 40 }, (_, i) => box(i * 15, 8, 12, 6 + (i % 3)));
    const others = [box(900, 24, 40, 18), box(950, 8, 12, 9, 3)];
    const buildings = [...houses, ...others];
    const grounds = buildings.map(() => ({ centre: 50, low: 50, high: 50 }));
    await l.loadRoofs(state, buildings, grounds);
    expect(collection.items).toHaveLength(1);
    const prim = collection.items[0] as FakePrimitive;
    expect(state.primitives).toEqual([prim]);
    expect(layer.owns(prim)).toBe(true);
    expect(prim.options.asynchronous).toBe(false);
    expect(prim.options.shadows).toBe(1);
    expect(prim.options.allowPicking).toBe(true);
    // One instance for each roofing in use, in its colour, marked as a roof.
    const used = new Set(houses.map((h) => roofShade(h.centre)));
    expect(prim.options.geometryInstances).toHaveLength(used.size);
    let roofs = 0;
    for (const inst of prim.options.geometryInstances) {
      const c = inst.attributes.color;
      expect(c.alpha).toBe(ROOF_ALPHA);
      const k = HOUSE_ROOFS.findIndex((p) => p[0] === c.r && p[1] === c.g && p[2] === c.b);
      expect(used.has(k)).toBe(true);
      const g = inst.geometry;
      const n = g.attributes.position.values.length / 3 / HIP_ROOF_VERTICES;
      expect(Number.isInteger(n) && n > 0).toBe(true);
      expect(houses.filter((h) => roofShade(h.centre) === k)).toHaveLength(n);
      expect(g.attributes.normal.values.length).toBe(g.attributes.position.values.length);
      expect(g.indices.length).toBe(n * 36);
      expect(Math.max(...g.indices)).toBe(n * HIP_ROOF_VERTICES - 1);
      expect(g.primitiveType).toBe(4);
      expect(g.boundingSphere.n).toBe(g.attributes.position.values.length);
      // Every vertex between the eaves' edge and the mapped height; every face at the pitch,
      // looking up or (the eaves' underside) down.
      for (let i = 0; i < g.attributes.position.values.length; i += 3) {
        const z = g.attributes.position.values[i + 2] as number;
        expect(z).toBeGreaterThan(53.4);
        expect(z).toBeLessThan(58.0001);
        expect(Math.abs(g.attributes.normal.values[i + 2] as number)).toBeGreaterThan(0.8);
      }
      roofs += n;
    }
    expect(roofs).toBe(houses.length);
  });

  it('spreads a city tile over primitives of 1,500 roofs, none lost', async () => {
    const { l, state, collection } = setup();
    const houses = Array.from({ length: 3100 }, (_, i) => box((i % 100) * 15, 8, 12, 6 + (i % 3)));
    await l.loadRoofs(
      state,
      houses,
      houses.map(() => ({ centre: 0, low: 0, high: 0 })),
    );
    const counts = collection.items.map((p) =>
      p.options.geometryInstances.reduce(
        (n, inst) => n + inst.geometry.attributes.position.values.length / 3 / HIP_ROOF_VERTICES,
        0,
      ),
    );
    expect(counts).toEqual([1500, 1500, 100]);
    // Each small enough for 16-bit indices whatever its roofings' shares.
    for (const p of collection.items)
      for (const inst of p.options.geometryInstances)
        expect(inst.geometry.indices).toBeInstanceOf(Uint16Array);
    expect(state.primitives).toHaveLength(3);
  });

  it('adds nothing where a tile has no house, or the tile went away meanwhile', async () => {
    const { l, state, collection } = setup();
    const blocks = [box(0, 24, 40, 18), box(60, 30, 30, 60)];
    await l.loadRoofs(
      state,
      blocks,
      blocks.map(() => ({ centre: 0, low: 0, high: 0 })),
    );
    expect(collection.items).toEqual([]);
    const gone = { ...state, cancelled: true };
    await l.loadRoofs(gone, [box(0, 8, 12, 7)], [{ centre: 0, low: 0, high: 0 }]);
    expect(collection.items).toEqual([]);
  });

  it('reports a roof primitive Cesium refuses and leaves the houses their walls', async () => {
    const { l, state, collection, errors } = setup(true);
    await l.loadRoofs(state, [box(0, 8, 12, 7)], [{ centre: 0, low: 0, high: 0 }]);
    expect(collection.items).toEqual([]);
    expect(state.primitives).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});

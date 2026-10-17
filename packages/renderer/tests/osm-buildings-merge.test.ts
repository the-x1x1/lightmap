/**
 * The buildings layer's asynchronous whole-tile build (`mergeSlices`) against a stand-in for
 * Cesium: a primitive that becomes ready after a few updates or fails in its "workers", a
 * collection that updates its primitives each frame, and a scene whose `requestRender` runs a
 * frame (preRender, then the primitives' update, which throws for a failed primitive as
 * Cesium's does).
 */
import { describe, expect, it } from 'vitest';
import { OsmBuildingsLayer } from '../src/cesium/osm-buildings-layer.ts';

class FakePrimitive {
  show = true;
  ready = false;
  appearance: unknown;
  _error: unknown = undefined;
  destroyed = false;
  updates = 0;
  plan: { readyAfter?: number; failAfter?: number };
  constructor(options: { geometryInstances: unknown[]; appearance: unknown }) {
    this.appearance = options.appearance;
    this.plan = FakePrimitive.next;
  }
  static next: { readyAfter?: number; failAfter?: number } = { readyAfter: 2 };
  update(): void {
    if (this._error !== undefined) throw new Error('primitive failed (thrown in the frame)');
    this.updates++;
    if (this.plan.failAfter !== undefined && this.updates >= this.plan.failAfter)
      this._error = new Error('worker failed');
    else if (this.plan.readyAfter !== undefined && this.updates >= this.plan.readyAfter)
      this.ready = true;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  getGeometryInstanceAttributes(): { show?: unknown } {
    return {};
  }
}

class FakeCollection {
  items: FakePrimitive[] = [];
  add(p: FakePrimitive): FakePrimitive {
    this.items.push(p);
    return p;
  }
  remove(p: FakePrimitive): boolean {
    const i = this.items.indexOf(p);
    if (i < 0) return false;
    this.items.splice(i, 1);
    p.destroyed = true;
    return true;
  }
}

function fakeCesium() {
  const C = {
    Primitive: FakePrimitive,
    PrimitiveCollection: FakeCollection,
    PerInstanceColorAppearance: class {
      static VERTEX_FORMAT = {};
    },
    ShadowMode: { ENABLED: 1 },
    ShowGeometryInstanceAttribute: { toValue: (on: boolean) => [on ? 1 : 0] },
  };
  const listeners: (() => void)[] = [];
  let frames = 0;
  const top = { list: [] as FakeCollection[] };
  const scene = {
    primitives: {
      add: (c: FakeCollection) => top.list.push(c),
      remove: (c: FakeCollection) => {
        top.list = top.list.filter((x) => x !== c);
        for (const p of [...c.items]) c.remove(p);
      },
    },
    preRender: {
      addEventListener: (fn: () => void) => {
        listeners.push(fn);
        return () => listeners.splice(listeners.indexOf(fn), 1);
      },
    },
    // A frame: preRender, then every primitive's update (as Cesium's render does).
    requestRender: () => {
      frames++;
      for (const fn of [...listeners]) fn();
      for (const c of top.list) for (const p of [...c.items]) p.update();
    },
    get frames() {
      return frames;
    },
  };
  return { C, scene, top };
}

function setup() {
  const { C, scene, top } = fakeCesium();
  const layer = new OsmBuildingsLayer(
    C as never,
    scene as never,
    'https://example.invalid/{z}/{x}/{y}.pbf',
    () => {},
  );
  // The private parts under test.
  const l = layer as unknown as {
    mergeSlices: (
      state: unknown,
      slices: FakePrimitive[],
      instances: unknown[],
      trees?: boolean,
    ) => Promise<FakePrimitive | null>;
    drop: (key: string, state: unknown) => void;
    tiles: Map<string, unknown>;
    lean: boolean;
  };
  const collection = top.list[0] as FakeCollection;
  const state = {
    key: '1/1',
    x: 1,
    y: 1,
    primitives: [] as FakePrimitive[],
    cancelled: false,
    done: Promise.resolve(),
    near: true,
    trees: [],
    footprints: [],
    bridges: [],
  };
  l.tiles.set(state.key, state);
  return { layer, l, collection, state, scene };
}

describe('the buildings layer builds a tile whole in the workers', () => {
  it('shows the merged primitive once ready and drops the slices it replaces', async () => {
    const { layer, l, collection, state } = setup();
    FakePrimitive.next = { readyAfter: 1 };
    const slice = collection.add(new FakePrimitive({ geometryInstances: [], appearance: null }));
    state.primitives.push(slice);
    FakePrimitive.next = { readyAfter: 3 };
    const merged = await l.mergeSlices(state, [slice], [{}, {}]);
    expect(merged).not.toBeNull();
    expect(merged!.show).toBe(true);
    expect(state.primitives).toEqual([merged]);
    expect(slice.destroyed).toBe(true);
    expect(layer.owns(merged)).toBe(true);
    expect(layer.owns(slice)).toBe(false);
  });

  it('drops a primitive whose workers failed before its frame can throw, and says so', async () => {
    const { l, collection, state, scene } = setup();
    FakePrimitive.next = { failAfter: 2 };
    const merged = await l.mergeSlices(state, [], [{}]);
    expect(merged).toBeNull();
    expect(collection.items).toEqual([]);
    expect(state.primitives).toEqual([]);
    // Frames after the failure run clean (the guard removed it in preRender).
    expect(() => scene.requestRender()).not.toThrow();
  });

  it('gives up a tile dropped while its build was pending', async () => {
    const { l, collection, state } = setup();
    FakePrimitive.next = { readyAfter: 1000 };
    const pending = l.mergeSlices(state, [], [{}]);
    l.drop(state.key, state);
    expect(await pending).toBeNull();
    expect(collection.items).toEqual([]);
  });

  it('keeps merged trees hidden on the lean rung', async () => {
    const { l, state } = setup();
    l.lean = true;
    FakePrimitive.next = { readyAfter: 2 };
    const merged = await l.mergeSlices(state, [], [{}], true);
    expect(merged!.show).toBe(false);
  });
});

describe('hasBuildingAt over a grid of a dense tile', () => {
  it('answers like a scan of every footprint: inside, within the 2.5 m reach, and clear of it', async () => {
    const { lonLatToTile } = await import('../src/vector-tile.ts');
    for (const lat0 of [35, 70]) {
      const { l, layer } = setup();
      const lon0 = 135.78;
      const t = lonLatToTile(14, lon0, lat0);
      const mLat = 1 / 110_540;
      const mLon = 1 / (111_320 * Math.cos((lat0 * Math.PI) / 180));
      // A 60 x 60 block of 8 m houses on a 20 m pitch (3,600 footprints).
      const fp = [];
      for (let i = 0; i < 60; i++)
        for (let j = 0; j < 60; j++) {
          const w = lon0 + i * 20 * mLon;
          const s = lat0 + j * 20 * mLat;
          const outer: [number, number][] = [
            [w, s],
            [w + 8 * mLon, s],
            [w + 8 * mLon, s + 8 * mLat],
            [w, s + 8 * mLat],
          ];
          fp.push({
            outer,
            holes: [],
            heightM: 6,
            minHeightM: 0,
            colour: null,
            centre: [w + 4 * mLon, s + 4 * mLat] as [number, number],
          });
        }
      // The block may straddle tile edges (a z14 tile is ~800 m wide at 70 deg): every tile it
      // touches holds it, as neighbouring tiles each hold the buildings across their edge.
      const t1 = lonLatToTile(14, lon0 + 1200 * mLon, lat0 + 1200 * mLat);
      for (let x = Math.min(t.x, t1.x); x <= Math.max(t.x, t1.x); x++)
        for (let y = Math.min(t.y, t1.y); y <= Math.max(t.y, t1.y); y++)
          l.tiles.set(`${x}/${y}`, { key: `${x}/${y}`, footprints: fp, bridges: [] });
      for (const [i, j] of [
        [0, 0],
        [17, 42],
        [59, 59],
      ] as const) {
        const w = lon0 + i * 20 * mLon;
        const s = lat0 + j * 20 * mLat;
        expect(layer.hasBuildingAt(w + 4 * mLon, s + 4 * mLat)).toBe(true); // inside
        expect(layer.hasBuildingAt(w + 10 * mLon, s + 4 * mLat)).toBe(true); // 2 m off a wall
        expect(layer.hasBuildingAt(w + 14 * mLon, s + 4 * mLat)).toBe(false); // 6 m off
      }
    }
  });
});

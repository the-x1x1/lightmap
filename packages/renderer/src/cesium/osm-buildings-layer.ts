/**
 * OpenStreetMap buildings around the camera, extruded on the terrain (the free buildings: no
 * Cesium ion token). Each z14 OpenMapTiles vector tile near where you stand or look is fetched,
 * its footprints read (`osm-buildings.ts`), the ground under each sampled from the terrain, and
 * the lot drawn as lit, shadow-casting, pickable prisms. Tiles far behind are dropped again.
 *
 * Geometry is built on the main thread a slice at a time (a dense city tile holds thousands of
 * footprints), each building in its own try: one malformed outline costs that building, never
 * the tile, and never the render loop (a failed asynchronous `Primitive` throws from inside the
 * frame).
 */
import type * as Cesium from '@cesium/engine';
import {
  BUILDING_TILE_ZOOM,
  buildingTilesAround,
  buildingsFromTile,
  tileUrl,
  type BuildingFootprint,
} from '../osm-buildings.ts';
import { lonLatToTile } from '../vector-tile.ts';

type CesiumModule = typeof Cesium;

/** Tiles reaching within this distance of the focus are loaded. */
const LOAD_RADIUS_M = 1800;
/** Tiles whose centre is further than this from the focus are dropped. */
const KEEP_RADIUS_M = 4500;
/** Beyond this camera height above the focus, nothing new is loaded (buildings would be specks). */
const MAX_LOAD_HEIGHT_M = 6000;
/** Footprints turned into geometry per slice (one slice per ~frame). */
const SLICE = 250;
/** The building's base sits this far into the ground, so a slope never shows a gap under it. */
const SINK_M = 2;

interface TileState {
  key: string;
  x: number;
  y: number;
  primitives: Cesium.Primitive[];
  cancelled: boolean;
  done: Promise<void>;
}

export class OsmBuildingsLayer {
  private readonly C: CesiumModule;
  private readonly scene: Cesium.Scene;
  private readonly collection: Cesium.PrimitiveCollection;
  private readonly source: string;
  private readonly onError: (message: string, error: unknown) => void;
  private template: string | null = null;
  private templateJob: Promise<string | null> | null = null;
  private readonly tiles = new Map<string, TileState>();
  private readonly owned = new Set<unknown>();
  private lastFocus: { lon: number; lat: number } | null = null;
  private destroyed = false;
  private failures = 0;

  constructor(
    C: CesiumModule,
    scene: Cesium.Scene,
    source: string,
    onError: (message: string, error: unknown) => void,
  ) {
    this.C = C;
    this.scene = scene;
    this.source = source;
    this.onError = onError;
    this.collection = new C.PrimitiveCollection();
    scene.primitives.add(this.collection);
  }

  /** Whether a picked primitive is one of these buildings. */
  owns(primitive: unknown): boolean {
    return this.owned.has(primitive);
  }

  /** How many buildings' primitives are on the globe (0 until the first tile is drawn). */
  get primitiveCount(): number {
    return this.owned.size;
  }

  /**
   * Called as the camera moves: the focus is where you stand (the Viewpoint) or the ground
   * you look at (the map); `heightAboveM` is how far above it the camera is.
   */
  update(lon: number, lat: number, heightAboveM: number, force = false): void {
    if (this.destroyed) return;
    if (heightAboveM > MAX_LOAD_HEIGHT_M) return;
    if (this.lastFocus && !force) {
      const dx = (lon - this.lastFocus.lon) * 111_320 * Math.cos((lat * Math.PI) / 180);
      const dy = (lat - this.lastFocus.lat) * 111_320;
      if (Math.hypot(dx, dy) < 150) return;
    }
    this.lastFocus = { lon, lat };
    const wanted = buildingTilesAround(lon, lat, LOAD_RADIUS_M);
    for (const t of wanted) {
      const key = `${t.x}/${t.y}`;
      if (!this.tiles.has(key)) {
        const state: TileState = {
          key,
          x: t.x,
          y: t.y,
          primitives: [],
          cancelled: false,
          done: Promise.resolve(),
        };
        this.tiles.set(key, state);
        state.done = this.load(state);
      }
    }
    // Drop tiles left far behind.
    const centre = lonLatToTile(BUILDING_TILE_ZOOM, lon, lat);
    const tileM = (40_075_016 * Math.cos((lat * Math.PI) / 180)) / 2 ** BUILDING_TILE_ZOOM;
    for (const [key, state] of this.tiles) {
      const d = Math.hypot(state.x - centre.x, state.y - centre.y) * tileM;
      if (d > KEEP_RADIUS_M) this.drop(key, state);
    }
  }

  /**
   * Loads the buildings around a point and resolves once they are drawn (or failed): the
   * horizon's building pass waits on this so its first run already sees them.
   */
  async loadAround(lon: number, lat: number): Promise<void> {
    this.update(lon, lat, 0, true);
    const keys = buildingTilesAround(lon, lat, LOAD_RADIUS_M).map((t) => `${t.x}/${t.y}`);
    await Promise.all(keys.map((k) => this.tiles.get(k)?.done ?? Promise.resolve()));
  }

  private drop(key: string, state: TileState): void {
    state.cancelled = true;
    for (const p of state.primitives) {
      this.owned.delete(p);
      this.collection.remove(p); // destroys it
    }
    state.primitives = [];
    this.tiles.delete(key);
    this.scene.requestRender();
  }

  private async resolveTemplate(): Promise<string | null> {
    if (this.template) return this.template;
    this.templateJob ??= (async () => {
      if (this.source.includes('{z}')) return this.source;
      const res = await fetch(this.source);
      if (!res.ok) throw new Error(`TileJSON ${res.status}`);
      const json = (await res.json()) as { tiles?: unknown };
      const first: unknown = Array.isArray(json.tiles) ? (json.tiles as unknown[])[0] : undefined;
      if (typeof first !== 'string') throw new Error('TileJSON has no tile template');
      return first;
    })().catch((error: unknown) => {
      this.templateJob = null; // try again on the next move
      this.report(error);
      return null;
    });
    this.template = await this.templateJob;
    return this.template;
  }

  private report(error: unknown): void {
    // One notice, not one per tile.
    if (this.failures++ === 0) this.onError('Buildings could not be loaded here', error);
  }

  private async load(state: TileState): Promise<void> {
    const C = this.C;
    try {
      const template = await this.resolveTemplate();
      if (!template || state.cancelled || this.destroyed) {
        if (!template) this.tiles.delete(state.key);
        return;
      }
      const res = await fetch(tileUrl(template, BUILDING_TILE_ZOOM, state.x, state.y));
      if (res.status === 404 || res.status === 204) return; // no data there (open sea)
      if (!res.ok) throw new Error(`building tile ${state.key}: HTTP ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      if (state.cancelled || this.destroyed) return;
      const buildings = buildingsFromTile(data, BUILDING_TILE_ZOOM, state.x, state.y);
      if (buildings.length === 0) return;

      // The ground under each building, from the terrain's finest tiles.
      const cartos = buildings.map((b) => C.Cartographic.fromDegrees(b.centre[0], b.centre[1]));
      let grounds: number[];
      try {
        const sampled = await C.sampleTerrainMostDetailed(this.scene.terrainProvider, cartos);
        grounds = sampled.map((c) => (Number.isFinite(c.height) ? c.height : 0));
      } catch {
        grounds = cartos.map(() => 0);
      }
      if (state.cancelled || this.destroyed) return;

      for (let i = 0; i < buildings.length; i += SLICE) {
        if (state.cancelled || this.destroyed) return;
        const primitive = this.buildSlice(
          buildings.slice(i, i + SLICE),
          grounds.slice(i, i + SLICE),
        );
        if (primitive) {
          state.primitives.push(primitive);
          this.owned.add(primitive);
          this.collection.add(primitive);
          this.scene.requestRender();
        }
        // Let a frame through between slices.
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (error) {
      this.tiles.delete(state.key);
      this.report(error);
    }
  }

  private buildSlice(
    buildings: readonly BuildingFootprint[],
    grounds: readonly number[],
  ): Cesium.Primitive | null {
    const C = this.C;
    const instances: Cesium.GeometryInstance[] = [];
    const vertexFormat = C.PerInstanceColorAppearance.VERTEX_FORMAT;
    buildings.forEach((b, i) => {
      try {
        const ground = grounds[i] ?? 0;
        const hierarchy = new C.PolygonHierarchy(
          C.Cartesian3.fromDegreesArray(b.outer.flat()),
          b.holes.map((h) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h.flat()))),
        );
        const geometry = C.PolygonGeometry.createGeometry(
          new C.PolygonGeometry({
            polygonHierarchy: hierarchy,
            height: ground + (b.minHeightM > 0 ? b.minHeightM : -SINK_M),
            extrudedHeight: ground + b.heightM,
            vertexFormat,
          }),
        );
        if (!geometry) return;
        instances.push(
          new C.GeometryInstance({
            geometry,
            attributes: {
              color: C.ColorGeometryInstanceAttribute.fromColor(buildingColour(C, b.colour)),
            },
          }),
        );
      } catch {
        // A footprint Cesium cannot triangulate is left out.
      }
    });
    if (instances.length === 0) return null;
    return new C.Primitive({
      geometryInstances: instances,
      appearance: new C.PerInstanceColorAppearance({
        flat: false,
        translucent: false,
        closed: true,
      }),
      shadows: C.ShadowMode.ENABLED,
      asynchronous: false,
      releaseGeometryInstances: true,
      allowPicking: true,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const s of this.tiles.values()) s.cancelled = true;
    this.tiles.clear();
    this.owned.clear();
    this.scene.primitives.remove(this.collection); // destroys it and its primitives
  }
}

/** OSM's own colour when mapped (tempered toward stone so it reads under any light), else stone. */
function buildingColour(C: CesiumModule, css: string | null): Cesium.Color {
  const stone = new C.Color(0.8, 0.78, 0.74, 1);
  if (!css) return stone;
  try {
    const c = C.Color.fromCssColorString(css);
    if (!c) return stone;
    return C.Color.lerp(stone, c, 0.6, new C.Color());
  } catch {
    return stone;
  }
}

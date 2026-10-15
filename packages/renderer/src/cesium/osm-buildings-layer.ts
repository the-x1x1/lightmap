/**
 * OpenStreetMap buildings around the camera, extruded on the terrain (the free buildings: no
 * Cesium ion token). Each z14 OpenMapTiles vector tile near where you stand or look is fetched,
 * its footprints read (`osm-buildings.ts`), the ground under each sampled from the terrain, and
 * the lot drawn as lit, shadow-casting, pickable prisms. The same tile's land cover grows trees
 * (`treesFromTile`): woods filled, parks scattered. Tiles far behind are dropped again.
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
  treesFromTile,
  type BuildingFootprint,
  type TreeSpot,
} from '../osm-buildings.ts';
import { lonLatToTile, tilePointToLonLat } from '../vector-tile.ts';

type CesiumModule = typeof Cesium;

/** Tiles reaching within this distance of the focus are loaded in full (every building, trees). */
const LOAD_RADIUS_M = 1800;
/**
 * Out to this distance only the tall buildings are loaded: the skyline across a bay or seen
 * from a hill, which is what a photographer frames from afar.
 */
const FAR_RADIUS_M = 6000;
const FAR_MIN_HEIGHT_M = 20;
/** Tiles whose centre is further than this from the focus are dropped. */
const KEEP_RADIUS_M = 8000;
/** Beyond this camera height above the focus, nothing new is loaded (buildings would be specks). */
const MAX_LOAD_HEIGHT_M = 6000;
/** Footprints turned into geometry per slice (one slice per ~frame). */
const SLICE = 250;
/**
 * Main-thread time one building slice may take, ms: Cesium triangulates footprints on the main
 * thread here (one bad footprint must not lose its neighbours), so a slice stops when its budget
 * is spent and the rest waits for the next frame.
 */
const SLICE_BUDGET_MS = 6;

/** The next frame (or, in a page that draws no frames, 50 ms). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 50);
  });
}
/** The building's base sits this far into the ground, so a slope never shows a gap under it. */
const SINK_M = 2;
/**
 * The n.l over which Cesium's shadow map fades a primitive's face into shadow by its normal
 * (`normalShadingSmooth` of its primitive bias); the host sets the same value.
 */
export const PRIMITIVE_NORMAL_SHADING_SMOOTH = 0.05;

/**
 * The buildings' and trees' fragment shader: Cesium's per-instance colour appearance lights
 * every face from the camera (a headlight), which would light a wall facing away from the Sun
 * as brightly as one facing it. Here the Sun (the scene light) lights the faces that face it,
 * a sky term, stronger on faces that look up, lights the rest, and light bounced off the sunlit
 * ground reaches the faces that look down (a crown's underside, an overhang) - all scaled by
 * the light's own colour, so dusk and night dim buildings with the ground.
 *
 * Shadows come on top from Cesium's shadow map, which multiplies the whole colour by its
 * darkness wherever the Sun is hidden - including every face turned away from the Sun, which
 * Cesium shades as in shadow by its normal. Those faces already carry only sky and bounce
 * light here, so the two together made them near black (a tree's underside at noon). The
 * shader divides out the factor Cesium will apply to an unoccluded face (`shadowD` is the
 * shadow map's darkness, 1 with shadows off; Cesium leaves fragments past `shadowMaxM`
 * alone), so a face turned away from the Sun shows its sky light, and a face the Sun would
 * light but something hides still darkens as the ground's shadows do.
 * ASCII only (some drivers reject anything else in shader source).
 */
export function litInstanceShader(shadowD = 1, shadowMaxM = 0): string {
  const d = Math.max(0.05, Math.min(1, shadowD)).toFixed(3);
  const maxM = Math.max(0, shadowMaxM).toFixed(1);
  return `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec4 v_color;

void main()
{
    vec3 normalEC = normalize(v_normalEC);
    vec3 shadeNormalEC = normalEC;
#ifdef FACE_FORWARD
    normalEC = faceforward(normalEC, vec3(0.0, 0.0, 1.0), -normalEC);
#endif
    vec4 color = czm_gammaCorrect(v_color);
    vec3 positionWC = (czm_inverseView * vec4(v_positionEC, 1.0)).xyz;
    vec3 upEC = normalize((czm_view * vec4(normalize(positionWC), 0.0)).xyz);
    float sun = max(dot(normalEC, czm_lightDirectionEC), 0.0);
    float sky = 0.5 + 0.5 * dot(normalEC, upEC);
    float sunUp = clamp(dot(upEC, czm_lightDirectionEC), 0.0, 1.0);
    float bounce = 0.12 * (1.0 - sky) * sunUp;
    vec3 light = czm_lightColor * (0.55 * sun + 0.16 + 0.14 * sky + bounce);
    vec3 lit = color.rgb * light;
    // Aerial perspective: a far skyline takes the haze's colour as distant terrain does (the
    // globe gets Cesium's fog; these primitives do not), from 1.5 km out.
    float dist = length(v_positionEC);
    float haze = clamp((dist - 1500.0) / 14000.0, 0.0, 0.55);
    vec3 hazeColor = czm_lightColor * vec3(0.36, 0.40, 0.46);
    vec3 outRgb = mix(lit, hazeColor, haze);
    // Cesium's factor for an unoccluded fragment: its normal shading over the first
    // PRIMITIVE_NORMAL_SHADING_SMOOTH of n.l, floored at the darkness; none beyond the shadow
    // distance.
    float cesiumSun = max(dot(shadeNormalEC, czm_lightDirectionEC), 0.0);
    float expected = max(clamp(cesiumSun / ${PRIMITIVE_NORMAL_SHADING_SMOOTH.toFixed(3)}, 0.0, 1.0), ${d});
    if (-v_positionEC.z < ${maxM}) outRgb /= expected;
    out_FragColor = vec4(outRgb, color.a);
}
`;
}

/** The lit shader without shadow compensation (shadows off). */
export const LIT_INSTANCE_FS = litInstanceShader();

/** The shadow map's darkness in steps of this, so a new shader is compiled a few times a day. */
const SHADOW_D_STEP = 0.05;

/**
 * The trees' shader: the lit shader above with the leaf season (leaf-season.ts) on broad-leaf
 * crowns, which carry an alpha just under 1 as their mark (the trees are opaque, so alpha is
 * free). Each crown turns yellow, orange or red by its own tone, a little before or after its
 * neighbours; as the leaves go it fades to grey-brown twigs and thins to a screen-door, so a
 * bare crown reads as the see-through haze of branches it is (its shadow thins with it).
 * Conifers and trunks are untouched.
 */
export function treeFragmentShader(
  leafOn: number,
  autumn: number,
  shadowD = 1,
  shadowMaxM = 0,
): string {
  const season = `
    if (v_color.a < 0.995) {
        float tone = clamp((v_color.g - 0.27) / 0.12, 0.0, 1.0);
        float h = fract(tone * 17.3 + v_color.r * 31.0);
        vec3 fall = h < 0.38 ? vec3(0.56, 0.44, 0.09) : (h < 0.72 ? vec3(0.60, 0.28, 0.07) : vec3(0.44, 0.11, 0.06));
        float turn = clamp(${autumn.toFixed(3)} * 1.35 - 0.35 * fract(h * 7.7), 0.0, 1.0);
        color.rgb = mix(color.rgb, czm_gammaCorrect(vec4(fall * (0.85 + 0.3 * fract(h * 5.3)), 1.0)).rgb, turn);
        float leaves = clamp(${leafOn.toFixed(3)} * 1.3 - 0.3 * fract(h * 3.3), 0.0, 1.0);
        if (leaves < 1.0) {
            color.rgb = mix(czm_gammaCorrect(vec4(0.36, 0.32, 0.28, 1.0)).rgb, color.rgb, leaves);
            float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (dither > 0.35 + 0.65 * leaves) discard;
        }
        color.a = 1.0;
    }`;
  const anchor = '    vec4 color = czm_gammaCorrect(v_color);';
  return litInstanceShader(shadowD, shadowMaxM).replace(anchor, anchor + season);
}

/** Broad-leaf crowns' alpha: the mark `treeFragmentShader` looks for. */
const BROADLEAF_ALPHA = 0.99;

/** Trees per primitive (their geometry is built in Cesium's workers). */
const TREE_SLICE = 1500;

interface TileState {
  key: string;
  x: number;
  y: number;
  primitives: Cesium.Primitive[];
  cancelled: boolean;
  done: Promise<void>;
  /** Every building and the trees (near), or only the skyline's tall buildings (far). */
  near: boolean;
  /** Each tree's primitive, instance ids (trunk, crown) and base, to hide the ones at the eye. */
  trees: { prim: Cesium.Primitive; id: number; base: Cesium.Cartesian3 }[];
  /** The tile's building footprints once read (empty: none there); null until then. */
  footprints: readonly BuildingFootprint[] | null;
}

/** Whether [lon, lat] is inside a ring (even-odd rule; the ring is not closed). */
function inRing(ring: readonly (readonly [number, number])[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as readonly [number, number];
    const [xj, yj] = ring[j] as readonly [number, number];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
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
  private readonly treePrims = new Set<Cesium.Primitive>();
  private treeIds = 0;
  /** Trees hidden because the eye stands in them: [primitive, id]. */
  private hiddenTrees: [Cesium.Primitive, number][] = [];
  private lastFocus: { lon: number; lat: number } | null = null;
  /** On the cheapest quality rungs: no trees drawn and no skyline ring. */
  private lean = false;
  /** The leaf season the trees are drawn in, and its shader (shared by every tree primitive). */
  private season = { leafOn: 1, autumn: 0 };
  private treeAppearance: Cesium.PerInstanceColorAppearance | null = null;
  /** The shadow map the shaders compensate for (`litInstanceShader`), and the buildings' shader. */
  private shadow = { d: 1, maxM: 0 };
  private buildingAppearance: Cesium.PerInstanceColorAppearance | null = null;
  private readonly buildingPrims = new Set<Cesium.Primitive>();
  /**
   * One slice of building or tree work per frame across every tile: tiles load side by side,
   * and their slices queued in the same frame made the walk into a dense city stutter.
   */
  private gate: Promise<void> = Promise.resolve();
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

  /**
   * The trees' primitives: left out of height sampling (the horizon and a pin on a roof),
   * because the trees are a pattern of a wood, not mapped trees.
   */
  treePrimitives(): Cesium.Primitive[] {
    return [...this.treePrims];
  }

  /**
   * The quality rung's say: lean (Battery and Minimal) hides the trees and skips the skyline
   * ring, which a slow machine pays for most; the buildings near you stay.
   */
  setLean(lean: boolean): void {
    if (lean === this.lean) return;
    this.lean = lean;
    for (const p of this.treePrims) p.show = !lean;
    if (lean) for (const [key, state] of this.tiles) if (!state.near) this.drop(key, state);
    this.lastFocus = null; // the next update reconsiders the rings
    this.scene.requestRender();
  }

  /**
   * The leaf season (leaf-season.ts) for the broad-leaf trees. A new date swaps the trees'
   * shader; no tree is rebuilt.
   */
  setSeason(leafOn: number, autumn: number): void {
    const q = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 50) / 50;
    const next = { leafOn: q(leafOn), autumn: q(autumn) };
    if (next.leafOn === this.season.leafOn && next.autumn === this.season.autumn) return;
    this.season = next;
    this.treeAppearance = null;
    const appearance = this.appearanceForTrees();
    for (const p of this.treePrims) p.appearance = appearance;
    this.scene.requestRender();
  }

  /**
   * The shadow map's darkness (1 with shadows off) and distance, which the buildings' and trees'
   * shader divides out on faces turned from the Sun (`litInstanceShader`). Quantised, so the
   * shaders are swapped (never rebuilt geometry) a few times over a sunset.
   */
  setShadowMap(enabled: boolean, darkness: number, maximumDistanceM: number): void {
    const d = enabled
      ? Math.max(SHADOW_D_STEP, Math.round(darkness / SHADOW_D_STEP) * SHADOW_D_STEP)
      : 1;
    const maxM = enabled && d < 1 ? Math.round(maximumDistanceM) : 0;
    if (d === this.shadow.d && maxM === this.shadow.maxM) return;
    this.shadow = { d, maxM };
    this.treeAppearance = null;
    this.buildingAppearance = null;
    const trees = this.appearanceForTrees();
    for (const p of this.treePrims) p.appearance = trees;
    const buildings = this.appearanceForBuildings();
    for (const p of this.buildingPrims) p.appearance = buildings;
    this.scene.requestRender();
  }

  private appearanceForTrees(): Cesium.PerInstanceColorAppearance {
    this.treeAppearance ??= new this.C.PerInstanceColorAppearance({
      flat: false,
      translucent: false,
      closed: true,
      fragmentShaderSource: treeFragmentShader(
        this.season.leafOn,
        this.season.autumn,
        this.shadow.d,
        this.shadow.maxM,
      ),
    });
    return this.treeAppearance;
  }

  private appearanceForBuildings(): Cesium.PerInstanceColorAppearance {
    this.buildingAppearance ??= new this.C.PerInstanceColorAppearance({
      flat: false,
      translucent: false,
      closed: true,
      fragmentShaderSource: litInstanceShader(this.shadow.d, this.shadow.maxM),
    });
    return this.buildingAppearance;
  }

  /**
   * Whether a mapped building stands at the point: true or false once its tile has been read
   * (near tiles hold every building, far ones only the tall), null while that is unknown.
   */
  hasBuildingAt(lon: number, lat: number): boolean | null {
    const t = lonLatToTile(BUILDING_TILE_ZOOM, lon, lat);
    const fp = this.tiles.get(`${t.x}/${t.y}`)?.footprints;
    if (!fp) return null;
    return fp.some((b) => inRing(b.outer, lon, lat) && !b.holes.some((h) => inRing(h, lon, lat)));
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
    const near = buildingTilesAround(lon, lat, LOAD_RADIUS_M);
    const nearKeys = new Set(near.map((t) => `${t.x}/${t.y}`));
    const far = buildingTilesAround(lon, lat, this.lean ? LOAD_RADIUS_M : FAR_RADIUS_M).filter(
      (t) => !nearKeys.has(`${t.x}/${t.y}`),
    );
    const want = (t: { x: number; y: number }, full: boolean) => {
      const key = `${t.x}/${t.y}`;
      const have = this.tiles.get(key);
      if (have && (have.near || !full)) return;
      if (have) this.drop(key, have); // a skyline tile come near: load it in full
      const state: TileState = {
        key,
        x: t.x,
        y: t.y,
        primitives: [],
        cancelled: false,
        done: Promise.resolve(),
        near: full,
        trees: [],
        footprints: null,
      };
      this.tiles.set(key, state);
      state.done = this.load(state);
    };
    for (const t of near) want(t, true);
    for (const t of far) want(t, false);
    // Drop tiles left far behind.
    const centre = lonLatToTile(BUILDING_TILE_ZOOM, lon, lat);
    const tileM = (40_075_016 * Math.cos((lat * Math.PI) / 180)) / 2 ** BUILDING_TILE_ZOOM;
    for (const [key, state] of this.tiles) {
      const d = Math.hypot(state.x - centre.x, state.y - centre.y) * tileM;
      if (d > KEEP_RADIUS_M) this.drop(key, state);
    }
  }

  /**
   * Hides the trees whose trunk stands within `radiusM` of the eye: the woods are a pattern, so
   * one may grow exactly where you stand, and from inside a crown nothing else shows.
   */
  hideTreesNear(eye: Cesium.Cartesian3, radiusM = 9): void {
    const C = this.C;
    const show = (prim: Cesium.Primitive, id: number, on: boolean) => {
      if (prim.isDestroyed() || !prim.ready) return false;
      for (const part of ['t', 'c']) {
        const a = prim.getGeometryInstanceAttributes(`${id}${part}`) as
          | { show?: unknown }
          | undefined;
        if (a) a.show = C.ShowGeometryInstanceAttribute.toValue(on);
      }
      return true;
    };
    for (const [prim, id] of this.hiddenTrees) show(prim, id, true);
    this.hiddenTrees = [];
    const r2 = radiusM * radiusM;
    for (const state of this.tiles.values())
      for (const t of state.trees)
        if (C.Cartesian3.distanceSquared(t.base, eye) < r2 && show(t.prim, t.id, false))
          this.hiddenTrees.push([t.prim, t.id]);
    this.scene.requestRender();
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
      this.treePrims.delete(p);
      this.buildingPrims.delete(p);
      this.collection.remove(p); // destroys it
    }
    state.primitives = [];
    this.tiles.delete(key);
    this.scene.requestRender();
  }

  /** The vector tiles' XYZ template, once the TileJSON has answered (null if it cannot). */
  tileTemplate(): Promise<string | null> {
    return this.resolveTemplate();
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

  /** Waits for this tile's turn: the frame after the previous slice of any tile. */
  private nextSlot(): Promise<void> {
    const turn = this.gate.then(nextFrame);
    this.gate = turn;
    return turn;
  }

  private report(error: unknown): void {
    // One notice, not one per tile.
    if (this.failures++ === 0) this.onError('Buildings could not be loaded here', error);
  }

  private async load(state: TileState): Promise<void> {
    try {
      const template = await this.resolveTemplate();
      if (!template || state.cancelled || this.destroyed) {
        if (!template) this.tiles.delete(state.key);
        return;
      }
      const res = await fetch(tileUrl(template, BUILDING_TILE_ZOOM, state.x, state.y));
      if (res.status === 404 || res.status === 204) {
        state.footprints = []; // no data there (open sea)
        return;
      }
      if (!res.ok) throw new Error(`building tile ${state.key}: HTTP ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      if (state.cancelled || this.destroyed) return;
      const all = buildingsFromTile(data, BUILDING_TILE_ZOOM, state.x, state.y);
      const buildings = state.near ? all : all.filter((b) => b.heightM >= FAR_MIN_HEIGHT_M);
      state.footprints = buildings;
      const [, tileLat] = tilePointToLonLat(BUILDING_TILE_ZOOM, state.x, state.y, 1, 0.5, 0.5);
      const trees = state.near
        ? treesFromTile(data, BUILDING_TILE_ZOOM, state.x, state.y, tileLat)
        : [];

      if (buildings.length > 0) {
        // The ground under each building, from the terrain's finest tiles.
        const grounds = await this.groundHeights(buildings.map((b) => b.centre));
        if (state.cancelled || this.destroyed) return;
        let i = 0;
        while (i < buildings.length) {
          await this.nextSlot();
          if (state.cancelled || this.destroyed) return;
          const slice = this.buildSlice(buildings, grounds, i);
          this.adopt(state, slice.primitive);
          i = slice.next;
        }
      }

      if (trees.length > 0) {
        const grounds = await this.groundHeights(trees.map((t) => [t.lon, t.lat]));
        if (state.cancelled || this.destroyed) return;
        for (let i = 0; i < trees.length; i += TREE_SLICE) {
          await this.nextSlot();
          if (state.cancelled || this.destroyed) return;
          const record: { id: number; base: Cesium.Cartesian3 }[] = [];
          const prim = this.treeSlice(
            trees.slice(i, i + TREE_SLICE),
            grounds.slice(i, i + TREE_SLICE),
            record,
          );
          this.adopt(state, prim, true);
          if (prim) for (const r of record) state.trees.push({ prim, ...r });
        }
      }
    } catch (error) {
      this.tiles.delete(state.key);
      this.report(error);
    }
  }

  private adopt(state: TileState, primitive: Cesium.Primitive | null, tree = false): void {
    if (!primitive) return;
    if (tree) {
      this.treePrims.add(primitive);
      primitive.show = !this.lean;
    } else this.buildingPrims.add(primitive);
    state.primitives.push(primitive);
    this.owned.add(primitive);
    this.collection.add(primitive);
    this.scene.requestRender();
  }

  /** The terrain's height at points, from its finest tiles (0 where it cannot say). */
  private async groundHeights(points: readonly (readonly [number, number])[]): Promise<number[]> {
    const C = this.C;
    const cartos = points.map(([lon, lat]) => C.Cartographic.fromDegrees(lon, lat));
    try {
      const sampled = await C.sampleTerrainMostDetailed(this.scene.terrainProvider, cartos);
      return sampled.map((c) => (Number.isFinite(c.height) ? c.height : 0));
    } catch {
      return cartos.map(() => 0);
    }
  }

  /**
   * A slice of trees: a trunk and a crown each (a round crown for broad-leaf, a cone for
   * needle-leaf), placed upright on the ground. Plain shapes from Cesium's own geometry, built
   * in its workers; they cast shadows like the buildings.
   */
  private treeSlice(
    trees: readonly TreeSpot[],
    grounds: readonly number[],
    record: { id: number; base: Cesium.Cartesian3 }[],
  ): Cesium.Primitive | null {
    const C = this.C;
    const instances: Cesium.GeometryInstance[] = [];
    const vertexFormat = C.PerInstanceColorAppearance.VERTEX_FORMAT;
    const bark = C.ColorGeometryInstanceAttribute.fromColor(new C.Color(0.32, 0.25, 0.18, 1));
    trees.forEach((t, i) => {
      const ground = (grounds[i] ?? 0) - 0.3;
      const base = C.Cartesian3.fromDegrees(t.lon, t.lat, ground);
      const enu = C.Transforms.eastNorthUpToFixedFrame(base);
      const id = ++this.treeIds;
      record.push({ id, base });
      const at = (up: number) =>
        C.Matrix4.multiplyByTranslation(enu, new C.Cartesian3(0, 0, up), new C.Matrix4());
      const crownH = t.conifer ? t.heightM * 0.8 : t.heightM * 0.6;
      const trunkH = t.heightM - crownH + (t.conifer ? 0.5 : t.radiusM * 0.4);
      instances.push(
        new C.GeometryInstance({
          geometry: new C.CylinderGeometry({
            length: trunkH,
            topRadius: 0.18,
            bottomRadius: 0.25,
            slices: 5,
            vertexFormat,
          }),
          modelMatrix: at(trunkH / 2),
          id: `${id}t`,
          attributes: { color: bark, show: new C.ShowGeometryInstanceAttribute(true) },
        }),
      );
      const g = 0.27 + 0.12 * t.tone;
      const leaf = C.ColorGeometryInstanceAttribute.fromColor(
        t.conifer
          ? new C.Color(0.12 + 0.05 * t.tone, g - 0.05, 0.13, 1)
          : new C.Color(0.2 + 0.08 * t.tone, g, 0.12 + 0.03 * t.tone, BROADLEAF_ALPHA),
      );
      const crownBase = t.heightM - crownH;
      instances.push(
        new C.GeometryInstance({
          geometry: t.conifer
            ? new C.CylinderGeometry({
                length: crownH,
                topRadius: 0,
                bottomRadius: t.radiusM,
                slices: 7,
                vertexFormat,
              })
            : new C.EllipsoidGeometry({
                radii: new C.Cartesian3(t.radiusM, t.radiusM, crownH / 2),
                stackPartitions: 5,
                slicePartitions: 7,
                vertexFormat,
              }),
          modelMatrix: at(crownBase + crownH / 2),
          id: `${id}c`,
          attributes: { color: leaf, show: new C.ShowGeometryInstanceAttribute(true) },
        }),
      );
    });
    if (instances.length === 0) return null;
    return new C.Primitive({
      geometryInstances: instances,
      appearance: this.appearanceForTrees(),
      shadows: C.ShadowMode.ENABLED,
      asynchronous: true,
      // Kept so single trees can be hidden (`hideTreesNear`) by their attributes.
      releaseGeometryInstances: true,
      allowPicking: true,
    });
  }

  /**
   * Buildings from `from` on, up to SLICE of them or SLICE_BUDGET_MS of work, as one primitive;
   * `next` is where the following slice starts.
   */
  private buildSlice(
    buildings: readonly BuildingFootprint[],
    grounds: readonly number[],
    from: number,
  ): { primitive: Cesium.Primitive | null; next: number } {
    const C = this.C;
    const instances: Cesium.GeometryInstance[] = [];
    const vertexFormat = C.PerInstanceColorAppearance.VERTEX_FORMAT;
    const started = performance.now();
    let i = from;
    for (; i < buildings.length && i < from + SLICE; i++) {
      if (i > from && performance.now() - started > SLICE_BUDGET_MS) break;
      const b = buildings[i] as BuildingFootprint;
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
        if (!geometry) continue;
        instances.push(
          new C.GeometryInstance({
            geometry,
            attributes: {
              color: C.ColorGeometryInstanceAttribute.fromColor(buildingColour(C, b)),
            },
          }),
        );
      } catch {
        // A footprint Cesium cannot triangulate is left out.
      }
    }
    if (instances.length === 0) return { primitive: null, next: i };
    const primitive = new C.Primitive({
      geometryInstances: instances,
      appearance: this.appearanceForBuildings(),
      shadows: C.ShadowMode.ENABLED,
      asynchronous: false,
      releaseGeometryInstances: true,
      allowPicking: true,
    });
    return { primitive, next: i };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const s of this.tiles.values()) s.cancelled = true;
    this.tiles.clear();
    this.owned.clear();
    this.treePrims.clear();
    this.buildingPrims.clear();
    this.scene.primitives.remove(this.collection); // destroys it and its primitives
  }
}

/**
 * Facade colours for buildings OpenStreetMap gives none: plaster, concrete, sandstone, brick,
 * with glass-and-steel greys for towers. Picked per building from its position, so a street of
 * houses is not one colour and the same building keeps its colour.
 */
const LOW_RISE: [number, number, number][] = [
  [0.86, 0.84, 0.8], // white plaster
  [0.78, 0.76, 0.72], // concrete
  [0.8, 0.72, 0.6], // sandstone
  [0.72, 0.66, 0.58], // warm render
  [0.62, 0.42, 0.34], // brick
  [0.7, 0.7, 0.68], // grey render
];
const HIGH_RISE: [number, number, number][] = [
  [0.62, 0.68, 0.74], // blue glass
  [0.74, 0.76, 0.78], // steel and glass
  [0.82, 0.8, 0.76], // concrete tower
  [0.56, 0.6, 0.62], // dark glass
];

function facadeColour(C: CesiumModule, b: BuildingFootprint): Cesium.Color {
  const h = Math.abs(Math.sin(b.centre[0] * 12.9898 + b.centre[1] * 78.233) * 43758.5453) % 1;
  const set = b.heightM > 35 ? HIGH_RISE : LOW_RISE;
  const [r, g, bl] = set[Math.floor(h * set.length) % set.length] ?? [0.8, 0.78, 0.74];
  // A little per-building shade so neighbours of one material still differ.
  const shade = 0.92 + 0.12 * ((h * 7.31) % 1);
  return new C.Color(r * shade, g * shade, bl * shade, 1);
}

/** OSM's own colour when mapped (tempered toward the facade so it reads under any light), else a facade colour. */
function buildingColour(C: CesiumModule, b: BuildingFootprint): Cesium.Color {
  const facade = facadeColour(C, b);
  if (!b.colour) return facade;
  try {
    const c = C.Color.fromCssColorString(b.colour);
    if (!c) return facade;
    return C.Color.lerp(facade, c, 0.6, new C.Color());
  } catch {
    return facade;
  }
}

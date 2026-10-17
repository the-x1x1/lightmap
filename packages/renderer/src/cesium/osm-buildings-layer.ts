/**
 * OpenStreetMap buildings around the camera, extruded on the terrain (the free buildings: no
 * Cesium ion token). Each z14 OpenMapTiles vector tile near where you stand or look is fetched,
 * its footprints read (`osm-buildings.ts`), the ground under each sampled from the terrain, and
 * the lot drawn as lit, shadow-casting, pickable prisms. The same tile's land cover grows trees
 * (`treesFromTile`): woods filled, parks scattered. Tiles far behind are dropped again.
 *
 * A tile's buildings are first built whole, as one primitive in Cesium's workers: nothing is
 * triangulated on the main thread, and a dense tile (Kyoto's hold 10,000-20,000 footprints)
 * shows in seconds. One outline the workers cannot triangulate fails that primitive; it is
 * dropped before its frame (a failed asynchronous `Primitive` would throw from inside the
 * frame) and the tile is built instead on the main thread a slice at a time, each building in
 * its own try, so a malformed outline costs that building only. Those slices, and the trees (in
 * slices of 1,500, which keep their ids), are then built again in the workers as one primitive
 * each, which replaces them when it is ready: a dense tile otherwise stayed dozens of
 * primitives (Midtown ~220, Kyoto ~370 on screen, each drawn again for every shadow cascade).
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
import { bridgeAt, bridgeLinesFromTile, type BridgeLine } from '../vector-cover.ts';

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
/** A tile's merge not ready by then is given up (its slices stay). */
const MERGE_TIMEOUT_MS = 60_000;

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
export function litInstanceShader(shadowD = 1, shadowMaxM = 0, roofs = false): string {
  const d = Math.max(0.05, Math.min(1, shadowD)).toFixed(3);
  const maxM = Math.max(0, shadowMaxM).toFixed(1);
  // Buildings: a flat roof is tar, gravel or membrane, a pitched one shingle or tile - darker
  // than the walls, and from a viewpoint stood on a roof or a map view the roofs are most of
  // what shows (V&V: every roof the colour of its walls). Each building's own tone picks a
  // shade of grey; tile colours are regional and left to OSM's own roof colour some day.
  const roofCode = roofs
    ? `
    float roofness = smoothstep(0.55, 0.85, dot(normalEC, upEC));
    float pick = fract(v_color.r * 97.0 + v_color.g * 13.0);
    vec3 roofCol = vec3(0.30, 0.30, 0.31) * (0.75 + 0.6 * pick);
    color.rgb = mix(color.rgb, czm_gammaCorrect(vec4(roofCol, 1.0)).rgb, 0.7 * roofness);`
    : '';
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
    vec3 upEC = normalize((czm_view * vec4(normalize(positionWC), 0.0)).xyz);${roofCode}
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
 * neighbours; as the leaves go it fades to grey-brown twigs and thins to a screen-door, densest
 * across the crown's middle and feathered at its edge, so a bare crown reads as the see-through
 * haze of branches it is (its shadow thins with it).
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
            color.rgb = mix(czm_gammaCorrect(vec4(0.30, 0.26, 0.22, 1.0)).rgb, color.rgb, leaves);
            // Twigs are densest where the line of sight crosses most of the crown (its middle)
            // and thin out to a feathered edge; white-noise dither, which reads as twigs where
            // a structured pattern read as netting (V&V: Boston Common in January).
            float facing = abs(dot(normalize(v_normalEC), normalize(-v_positionEC)));
            float keep = leaves + (1.0 - leaves) * (0.08 + 0.55 * facing * facing);
            float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
            if (dither > keep) discard;
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
  /** The tile's bridge decks (near tiles only), once read. */
  bridges: readonly BridgeLine[];
}

const boxes = new WeakMap<BuildingFootprint, [number, number, number, number]>();

/** A footprint's [west, south, east, north] in degrees, worked out once. */
function footprintBox(b: BuildingFootprint): [number, number, number, number] {
  let box = boxes.get(b);
  if (!box) {
    box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of b.outer) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
    boxes.set(b, box);
  }
  return box;
}

/** Whether [lon, lat] is within (dx, dy) degrees of any edge of a ring (scaled to a unit circle). */
function nearRing(
  ring: readonly (readonly [number, number])[],
  lon: number,
  lat: number,
  dx: number,
  dy: number,
): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j] as readonly [number, number];
    const [bx, by] = ring[i] as readonly [number, number];
    const ux = (bx - ax) / dx;
    const uy = (by - ay) / dy;
    const px = (lon - ax) / dx;
    const py = (lat - ay) / dy;
    const len2 = ux * ux + uy * uy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * ux + py * uy) / len2)) : 0;
    if (Math.hypot(px - t * ux, py - t * uy) <= 1) return true;
  }
  return false;
}

/** The ground at a footprint, metres above the ellipsoid. */
interface FootprintGround {
  centre: number;
  low: number;
  high: number;
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
  /** Tiles' merged building primitives still being built in the workers (hidden). */
  private readonly merging = new Set<Cesium.Primitive>();
  private readonly removeGuard: () => void;
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
    // A merge whose worker failed would throw from the primitives' update: drop it first.
    this.removeGuard = scene.preRender.addEventListener(() => {
      for (const p of this.merging)
        if (p.isDestroyed() || (p as unknown as { _error?: unknown })._error !== undefined) {
          this.merging.delete(p);
          if (!p.isDestroyed()) this.collection.remove(p);
        }
    });
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
      fragmentShaderSource: litInstanceShader(this.shadow.d, this.shadow.maxM, true),
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
    // Within the pick's own reach of a wall counts (the surface probe is 2 m wide, so a horizon
    // sample just outside a footprint can meet its wall); a box test first, then the ring.
    const mLat = 1 / 110_540;
    const mLon = 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const reach = 2.5;
    return fp.some((b) => {
      const box = footprintBox(b);
      if (
        lon < box[0] - reach * mLon ||
        lon > box[2] + reach * mLon ||
        lat < box[1] - reach * mLat ||
        lat > box[3] + reach * mLat
      )
        return false;
      if (inRing(b.outer, lon, lat) && !b.holes.some((h) => inRing(h, lon, lat))) return true;
      return nearRing(b.outer, lon, lat, reach * mLon, reach * mLat);
    });
  }

  /** The mapped bridge deck under the point (near tiles, once read), or null. */
  bridgeAt(lon: number, lat: number): BridgeLine | null {
    const t = lonLatToTile(BUILDING_TILE_ZOOM, lon, lat);
    const state = this.tiles.get(`${t.x}/${t.y}`);
    return state ? bridgeAt(state.bridges, lon, lat) : null;
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
        bridges: [],
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
          { show?: unknown } | undefined;
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
      if (state.near)
        state.bridges = bridgeLinesFromTile(data, BUILDING_TILE_ZOOM, state.x, state.y);
      const [, tileLat] = tilePointToLonLat(BUILDING_TILE_ZOOM, state.x, state.y, 1, 0.5, 0.5);
      const trees = state.near
        ? treesFromTile(data, BUILDING_TILE_ZOOM, state.x, state.y, tileLat)
        : [];

      if (buildings.length > 0) {
        // The ground under each building, from the terrain's finest tiles: at its centre and,
        // on a slope, the lowest and highest of up to six of its corners.
        const grounds = await this.footprintGrounds(buildings);
        if (state.cancelled || this.destroyed) return;
        // First the whole tile at once in Cesium's workers: no triangulation on the main thread,
        // and a dense tile (Kyoto's hold 10,000-20,000 footprints) shows in seconds instead of
        // a slice a frame for hundreds of frames. A footprint the workers cannot triangulate
        // fails the whole primitive; then the tile is built in checked slices as before.
        const whole = await this.describeAll(state, buildings, grounds);
        if (!whole) return;
        const built = whole.length > 0 && (await this.mergeSlices(state, [], whole));
        if (state.cancelled || this.destroyed) return;
        let i = built || whole.length === 0 ? buildings.length : 0;
        const slices: Cesium.Primitive[] = [];
        const again: Cesium.GeometryInstance[] = [];
        while (i < buildings.length) {
          await this.nextSlot();
          if (state.cancelled || this.destroyed) return;
          const slice = this.buildSlice(buildings, grounds, i, again);
          this.adopt(state, slice.primitive);
          if (slice.primitive) slices.push(slice.primitive);
          i = slice.next;
        }
        if (slices.length > 1) void this.mergeSlices(state, slices, again);
      }

      if (trees.length > 0) {
        const grounds = await this.groundHeights(trees.map((t) => [t.lon, t.lat]));
        if (state.cancelled || this.destroyed) return;
        const slices: Cesium.Primitive[] = [];
        const again: Cesium.GeometryInstance[] = [];
        for (let i = 0; i < trees.length; i += TREE_SLICE) {
          await this.nextSlot();
          if (state.cancelled || this.destroyed) return;
          const record: { id: number; base: Cesium.Cartesian3 }[] = [];
          const prim = this.treeSlice(
            trees.slice(i, i + TREE_SLICE),
            grounds.slice(i, i + TREE_SLICE),
            record,
            again,
          );
          this.adopt(state, prim, true);
          if (prim) {
            slices.push(prim);
            for (const r of record) state.trees.push({ prim, ...r });
          }
        }
        if (slices.length > 1) void this.mergeSlices(state, slices, again, true);
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

  /**
   * Builds a tile's buildings (or trees) as one primitive in Cesium's workers and, once it is
   * ready, shows it in place of the slices drawn meanwhile, if any (same shapes, colours, ids
   * and shader). False when it failed, timed out or the tile went away.
   */
  private async mergeSlices(
    state: TileState,
    slices: readonly Cesium.Primitive[],
    instances: Cesium.GeometryInstance[],
    trees = false,
  ): Promise<boolean> {
    const C = this.C;
    const appearance = () => (trees ? this.appearanceForTrees() : this.appearanceForBuildings());
    const merged = new C.Primitive({
      geometryInstances: instances,
      appearance: appearance(),
      shadows: C.ShadowMode.ENABLED,
      asynchronous: true,
      releaseGeometryInstances: true,
      allowPicking: true,
    });
    merged.show = false; // Cesium builds a hidden primitive all the same
    this.merging.add(merged);
    this.collection.add(merged);
    const started = performance.now();
    const gone = () =>
      state.cancelled || this.destroyed || merged.isDestroyed() || !this.merging.has(merged);
    while (!merged.ready && !gone() && performance.now() - started < MERGE_TIMEOUT_MS) {
      this.scene.requestRender();
      await nextFrame();
    }
    const failed = gone() || !merged.ready;
    this.merging.delete(merged);
    if (failed) {
      if (!merged.isDestroyed() && !this.destroyed) this.collection.remove(merged);
      return false;
    }
    // The shader may have moved on (the Sun set, the season turned) while the workers built it.
    merged.appearance = appearance();
    merged.show = trees ? !this.lean : true;
    const replaced = new Set<Cesium.Primitive>(slices);
    if (trees) {
      // The trees keep their ids: their records, and any hidden at the eye, move across.
      for (const t of state.trees) if (replaced.has(t.prim)) t.prim = merged;
      this.hiddenTrees = this.hiddenTrees.map(([p, id]): [Cesium.Primitive, number] => {
        if (!replaced.has(p)) return [p, id];
        for (const part of ['t', 'c']) {
          const a = merged.getGeometryInstanceAttributes(`${id}${part}`) as
            { show?: unknown } | undefined;
          if (a) a.show = C.ShowGeometryInstanceAttribute.toValue(false);
        }
        return [merged, id];
      });
    }
    for (const p of slices) {
      this.owned.delete(p);
      this.buildingPrims.delete(p);
      this.treePrims.delete(p);
      this.collection.remove(p); // destroys it
    }
    state.primitives = state.primitives.filter((q) => !replaced.has(q));
    state.primitives.push(merged);
    this.owned.add(merged);
    (trees ? this.treePrims : this.buildingPrims).add(merged);
    this.scene.requestRender();
    return true;
  }

  /** The ground at each footprint: its centre, and the lowest and highest of its corners. */
  private async footprintGrounds(
    buildings: readonly BuildingFootprint[],
  ): Promise<FootprintGround[]> {
    const points: (readonly [number, number])[] = [];
    const spans: [number, number][] = [];
    for (const b of buildings) {
      const start = points.length;
      points.push(b.centre);
      const ring = b.outer;
      const step = Math.max(1, Math.ceil(ring.length / 6));
      for (let k = 0; k < ring.length; k += step) points.push(ring[k] as [number, number]);
      spans.push([start, points.length]);
    }
    const h = await this.groundHeightsOrNull(points);
    return spans.map(([a, z]) => {
      // A point the terrain could not answer is left out (0 would sink a wall to the ellipsoid).
      let centre = h[a] ?? null;
      for (let k = a + 1; centre === null && k < z; k++) centre = h[k] ?? null;
      const c = centre ?? 0;
      let low = c;
      let high = c;
      for (let k = a + 1; k < z; k++) {
        const v = h[k] ?? c;
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
      return { centre: c, low, high };
    });
  }

  /** The terrain's height at points, from its finest tiles (0, or null below, where it cannot say). */
  private async groundHeights(points: readonly (readonly [number, number])[]): Promise<number[]> {
    return (await this.groundHeightsOrNull(points)).map((h) => h ?? 0);
  }

  private async groundHeightsOrNull(
    points: readonly (readonly [number, number])[],
  ): Promise<(number | null)[]> {
    const missing = null;
    const C = this.C;
    const cartos = points.map(([lon, lat]) => C.Cartographic.fromDegrees(lon, lat));
    try {
      const sampled = await C.sampleTerrainMostDetailed(this.scene.terrainProvider, cartos);
      return sampled.map((c: Cesium.Cartographic) =>
        Number.isFinite(c.height) ? c.height : missing,
      );
    } catch {
      return cartos.map(() => missing);
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
    again: Cesium.GeometryInstance[],
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
      // Each shape twice: once for this slice, once for the tile's merge (`again`).
      const trunk = () =>
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
        });
      instances.push(trunk());
      again.push(trunk());
      const g = 0.27 + 0.12 * t.tone;
      const leaf = C.ColorGeometryInstanceAttribute.fromColor(
        t.conifer
          ? new C.Color(0.12 + 0.05 * t.tone, g - 0.05, 0.13, 1)
          : new C.Color(0.2 + 0.08 * t.tone, g, 0.12 + 0.03 * t.tone, BROADLEAF_ALPHA),
      );
      const crownBase = t.heightM - crownH;
      const crown = () =>
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
        });
      instances.push(crown());
      again.push(crown());
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

  /** A footprint's extrusion as a geometry description (not yet triangulated), and its colour. */
  private describeBuilding(
    b: BuildingFootprint,
    gr: FootprintGround | undefined,
  ): { description: Cesium.PolygonGeometry; colour: Cesium.Color } | null {
    const C = this.C;
    const g = gr ?? { centre: 0, low: 0, high: 0 };
    const ground = g.centre;
    const hierarchy = new C.PolygonHierarchy(
      C.Cartesian3.fromDegreesArray(b.outer.flat()),
      b.holes.map((h) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h.flat()))),
    );
    const description = new C.PolygonGeometry({
      polygonHierarchy: hierarchy,
      // On a slope the walls start under the lowest corner, and the roof stands clear of the
      // highest (V&V: Kyoto's Higashiyama, where the hillside came up through roofs in a
      // saw-tooth of terrain triangles). A part lifted off the ground keeps its own heights from
      // the centre.
      height: b.minHeightM > 0 ? ground + b.minHeightM : g.low - SINK_M,
      extrudedHeight:
        b.minHeightM > 0
          ? ground + b.heightM
          : Math.max(ground + b.heightM, g.high + Math.min(b.heightM, 2.5)),
      vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
    });
    return { description, colour: buildingColour(C, b) };
  }

  /**
   * Every footprint of a tile as geometry descriptions for the workers, a frame's budget at a
   * time (describing is cheap: no triangulation here). Null when the tile went away meanwhile.
   */
  private async describeAll(
    state: TileState,
    buildings: readonly BuildingFootprint[],
    grounds: readonly FootprintGround[],
  ): Promise<Cesium.GeometryInstance[] | null> {
    const C = this.C;
    const out: Cesium.GeometryInstance[] = [];
    let i = 0;
    while (i < buildings.length) {
      await this.nextSlot();
      if (state.cancelled || this.destroyed) return null;
      const started = performance.now();
      for (; i < buildings.length; i++) {
        if (performance.now() - started > SLICE_BUDGET_MS) break;
        try {
          const d = this.describeBuilding(buildings[i] as BuildingFootprint, grounds[i]);
          if (d)
            out.push(
              new C.GeometryInstance({
                geometry: d.description,
                attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(d.colour) },
              }),
            );
        } catch {
          // An outline Cesium refuses even to describe is left out.
        }
      }
    }
    return out;
  }

  /**
   * Buildings from `from` on, up to SLICE of them or SLICE_BUDGET_MS of work, as one primitive;
   * `next` is where the following slice starts. Each footprint that built is also added to
   * `again` as a geometry description, for the tile's merge.
   */
  private buildSlice(
    buildings: readonly BuildingFootprint[],
    grounds: readonly FootprintGround[],
    from: number,
    again: Cesium.GeometryInstance[],
  ): { primitive: Cesium.Primitive | null; next: number } {
    const C = this.C;
    const instances: Cesium.GeometryInstance[] = [];
    const started = performance.now();
    let i = from;
    for (; i < buildings.length && i < from + SLICE; i++) {
      if (i > from && performance.now() - started > SLICE_BUDGET_MS) break;
      const b = buildings[i] as BuildingFootprint;
      try {
        const described = this.describeBuilding(b, grounds[i]);
        if (!described) continue;
        const { description, colour } = described;
        const geometry = C.PolygonGeometry.createGeometry(description);
        if (!geometry) continue;
        instances.push(
          new C.GeometryInstance({
            geometry,
            attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(colour) },
          }),
        );
        again.push(
          new C.GeometryInstance({
            geometry: description,
            attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(colour) },
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
    this.removeGuard();
    this.merging.clear();
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

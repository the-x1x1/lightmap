/**
 * CesiumSceneHost — the renderer's Cesium side (ADR-0002), with its helpers beside it in
 * `cesium/` (the free OpenStreetMap buildings are osm-buildings-layer.ts).
 *
 * Why `@cesium/engine` and not `cesium`: the meta-package re-exports `@cesium/widgets`, which
 * bundles Knockout, whose module-scope `eval` breaks a strict Content-Security-Policy. The engine
 * has `CesiumWidget`, which is all LightMap needs. (Finding carried over from the owner's
 * WorldView audit; see docs/WORLDVIEW_REUSE_AUDIT.md.)
 *
 * Static assets (Workers, ThirdParty, Assets) are served from `window.CESIUM_BASE_URL`, which the
 * web app sets to `/cesium` before this module is imported (scripts/copy-cesium-assets.ts).
 */
import type * as Cesium from '@cesium/engine';
import type {
  BasemapDescriptor,
  BuildingsDescriptor,
  GeoPoint,
  LandCoverDescriptor,
  TerrainDescriptor,
} from '@lightmap/geospatial';
import { GRADE_FRAGMENT_SHADER } from '../shaders/grade.frag.ts';
import { OsmBuildingsLayer, PRIMITIVE_NORMAL_SHADING_SMOOTH } from './osm-buildings-layer.ts';
import { coverShapesFromTile, streetLinesFromTile } from '../vector-cover.ts';
import { lonLatToTile, tilePointToLonLat } from '../vector-tile.ts';
import { createDetailTexture, createNoiseTexture, type DetailTileCesium } from './detail-tiles.ts';
import { NOISE_TEXTURE_SIZE, makeNoiseTexture } from '../noise-texture.ts';
import { FrameRateSampler } from '../frame-sampler.ts';
import { geoidCellKey, geoidHeightM } from '../geoid.ts';
import { GLOBE_MASK_SAMPLE_LINE, patchGlobeFragmentSource } from '../water-mask.ts';
import {
  EYE_EASE_MAX_M,
  clearOrbitPitch,
  eyeDistanceM,
  eyeGlideDurationMs,
  eyeLift,
  glideEyeAt,
  orbitSightLine,
  steeperPitches,
  type EyePosition,
} from '../camera-math.ts';
import {
  countryDistanceBandM,
  parsePlaceLabels,
  placeMaxDistanceM,
  placeRank,
  visibleLabelIndices,
  type LabelCandidate,
  type PlaceLabelSet,
} from '../place-labels.ts';
import {
  GROUND_COVER_BOUNDS_UNIFORM,
  GROUND_COVER_IMAGE_UNIFORM,
  GROUND_ROAD_BOUNDS_UNIFORM,
  GROUND_ROAD_IMAGE_UNIFORM,
  GROUND_DETAIL_UNIFORM,
  GROUND_MATERIAL_SOURCE,
  GROUND_NOISE_UNIFORM,
  GROUND_MATERIAL_TYPE,
} from '../shaders/ground.frag.ts';
import { coverMapFromPixels, coverMosaicFor, packCover, tileUrl } from '../land-cover.ts';
import {
  decodeUrbanCell,
  mosaicBox,
  mosaicPixel,
  urbanCellsFor,
  type UrbanPolygon,
} from '../urban-areas.ts';
import { pickSurface } from '../pick.ts';
import {
  seasonKey,
  seasonShows,
  seasonalisePixels,
  type ImagerySeason,
} from '../imagery-season.ts';
import { FrameBudgetQueue } from '../frame-budget.ts';
import { drawMoonPhase } from '../moon-disc.ts';
import {
  anchorGroundFrame,
  groundMaterialUniforms,
  newGroundFrame,
  updateGroundOffsets,
  type GroundFrame,
} from './ground-material.ts';
import { StepGlide, lerpVec3, nlerpDir, type Vec3Like } from '../step-glide.ts';
import type { Vec3 } from '../sun-vector.ts';
import type {
  HostAtmosphere,
  HostCamera,
  HostGlobeShading,
  HostGradeUniforms,
  HostGroundTexture,
  HostLight,
  HostMoonDisc,
  HostSunGlare,
  HostPlanet,
  HostOrbitCamera,
  HostOverlay,
  HostQuality,
  HostShadows,
  HostStats,
  LandCoverReading,
  SceneHost,
} from './host.ts';

export type CesiumModule = typeof Cesium;

export interface CesiumHostOptions {
  container: HTMLElement;
  creditContainer: HTMLElement;
  /** Public ion token for ion-backed terrain/imagery; absent otherwise. */
  ionToken?: string;
  /** Render only when something changed (battery-friendly). */
  requestRenderMode?: boolean;
  msaaSamples?: number;
  /**
   * URL of the ground detail atlas (texture pack stage 3: grass, rock, sand, snow tiles in one
   * image); absent, the near field keeps its procedural grain.
   */
  groundDetailAtlasUrl?: string;
  /** URL of the bundled place labels (`place-labels.json`); absent, the globe carries no names. */
  placeLabelsUrl?: string;
  /**
   * Base URL of the bundled urban-area cells (`data/urban/`): with no land-cover source, the
   * ground texture paints these as built-up ground. Absent, nothing is.
   */
  urbanAreasUrl?: string;
  /** Base URL of the bundled geoid cells (`data/geoid/`): sea level for the shore and coast rules. */
  geoidUrl?: string;
  onError?: (message: string, error: unknown) => void;
}

export async function loadCesium(): Promise<CesiumModule> {
  return import('@cesium/engine');
}

export async function createCesiumHost(options: CesiumHostOptions): Promise<SceneHost> {
  const C = await loadCesium();
  return new CesiumSceneHost(C, options);
}

const DEG = Math.PI / 180;

const HIDDEN_RUN_POOL = 6;
/** Most place names held in the label collection at once (the best ranked in view). */
const PLACE_LABELS_MAX = 400;
/** Least time between two picks of the names while the camera keeps moving. */
const LABEL_PICK_INTERVAL_MS = 200;
/**
 * Without a pin to anchor to, the detail tiles' ground frame is re-anchored when the point under
 * the camera has moved this far, metres. A re-anchor shifts the whole pattern, so it must be
 * rare: with a pin the frame stays at the pin (zooming in and out never moves it).
 */
const DETAIL_REANCHOR_M = 200_000;

/** New place labels per frame (each rasterises its text). */
const LABELS_ADDED_PER_FRAME = 24;

/** The season must hold this long (ms) before the imagery is refetched in it. */
const SEASON_SWAP_SETTLE_MS = 250;

/** The grade's values that follow the clock (the rest — the weather's — change at once). */
const GRADE_GLIDE_KEYS = [
  'u_saturation',
  'u_contrast',
  'u_warmth',
  'u_skyLuminance',
  'u_nightFactor',
  'u_horizonHaze',
  'u_sunElevation',
  'u_time',
] as const;

/** The Moon's phase image, pixels square. */
const MOON_IMAGE_PX = 128;
/**
 * How far out along its direction the Moon's disc is placed, metres: beyond any terrain, so
 * every ridge in front of it hides it.
 */
const MOON_DISC_RANGE_M = 5_000_000;

/** The grade's planet uniforms, one per naked-eye planet in `PLANETS` order. */
const PLANET_SLOTS = ['u_planet0', 'u_planet1', 'u_planet2', 'u_planet3', 'u_planet4'] as const;

/** Clock steps longer than this (seconds) land at once instead of gliding. */
const CLOCK_GLIDE_MAX_S = 600;

/**
 * The longest a small clock or light step glides, ms. The slowest play pace (2 day-minutes a
 * second, `PLAY_RATES` in the web app) moves the clock a minute every 500 ms; a glide shorter
 * than that left the Sun disc, the stars and the sky's colours still for part of every step, a
 * visible pulse. Steps arriving at most this far apart glide over the time between them, so that
 * pace is one continuous drift; a step on its own (a key press, a click on the slider, the first
 * step after play) glides `LONE_STEP_GLIDE_MS` instead, so it does not trail the input.
 */
const STEP_GLIDE_MAX_MS = 550;
const LONE_STEP_GLIDE_MS = 250;

/** Light steps wider than this (cosine of 2°) land at once instead of gliding. */
const LIGHT_GLIDE_MAX_COS = Math.cos((2 * Math.PI) / 180);

/** The reader's "reduce motion" setting (false where it cannot be read). */
function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

export class CesiumSceneHost implements SceneHost {
  private readonly C: CesiumModule;
  private readonly widget: Cesium.CesiumWidget;
  private readonly scene: Cesium.Scene;
  private readonly light: Cesium.DirectionalLight;
  private readonly grade: Cesium.PostProcessStage;
  private readonly gradeUniforms: Record<string, unknown>;
  private groundMaterial: Cesium.Material | null = null;
  private buildings: Cesium.Cesium3DTileset | null = null;
  /** The free OpenStreetMap buildings (vector tiles), loaded around the camera. */
  private osmBuildings: OsmBuildingsLayer | null = null;
  /** The leaf season of the last ground texture, for trees loaded after it. */
  private leaf = { leafOn: 1, autumn: 0, grassGreen: 1, deciduous: 1 };
  /** Lying snow around the place, 0-1 (the ground texture's `snowCover`), for the far imagery. */
  private snowCover = 0;
  /** The chart's dimming (`setGlobeShading`): 1 by day, lower for the unlit night chart. */
  private basemapBrightness = 1;
  /** The base imagery's tiles take the season per pixel (`seasonalise`), and for which season. */
  private seasonalTiles = false;
  private imagerySeasonKey = '';
  private seasonSwapTimer: ReturnType<typeof setTimeout> | null = null;
  /** Removes the base layer a season swap replaced, once the new one's tiles are in. */
  private retireLayer: (() => void) | null = null;
  private retiringBase: Cesium.ImageryLayer | null = null;
  private osmBuildingsCheckAt = 0;
  private osmLean = false;
  /** The street map near the place (`u_roadMap`) and its bounds. */
  private roadCanvas: HTMLCanvasElement | null = null;
  private roadBounds: [number, number, number, number] | null = null;
  private roadLoadSeq = 0;
  /** Where the street map is centred, and the vector tiles' template it was drawn from. */
  private roadCentre: { lon: number; lat: number } | null = null;
  private roadTemplate: string | null = null;
  private buildingsJob: Promise<void> | null = null;
  private groundTextureFailed = false;
  private landCover: LandCoverDescriptor = { kind: 'none', attribution: '' };
  /** The cover map's bounds once loaded (`u_coverBounds`), applied when the material exists. */
  private coverBounds: [number, number, number, number] | null = null;
  private coverCanvas: HTMLCanvasElement | null = null;
  private coverLoadSeq = 0;
  private readonly detailAtlasUrl: string | undefined;
  private readonly urbanAreasUrl: string | undefined;
  private readonly geoidUrl: string | undefined;
  private readonly geoidCells = new Map<string, Promise<ArrayBuffer | null>>();
  private urbanIndex: Promise<Set<string> | null> | null = null;
  private readonly urbanCells = new Map<string, Promise<UrbanPolygon[]>>();
  private readonly enuScratch: GroundFrame;
  /** The detail atlas once its image has loaded; the material takes it then, never a URL. */
  private detailAtlas: HTMLImageElement | null = null;
  /** The detail tiles' texture once handed to the material (which destroys it with itself). */
  private detailTexture: { destroy(): void } | null = null;
  /** The baked noise, computed once; a texture of it is made for each material. */
  private noiseBytes: Uint8Array | null = null;
  /** 1 while the basemap is the bundled coarse one (`u_coarseBasemap`). */
  private coarseBasemap = 1;
  private readonly eyeUpScratch: Cesium.Cartesian3;
  /** The quality rung's ground detail level, which `u_detail` eases toward. */
  private detailTarget: number | null = null;
  private detailEaseAt = 0;
  /** Where the detail tiles' ground frame is anchored: the pin, from the camera request. */
  private detailAnchorTarget: Cesium.Cartesian3 | null = null;
  /** Place and country names on the globe (orbit only), with their ECEF positions for the horizon test. */
  private labels: Cesium.LabelCollection | null = null;
  /** Every name that may be drawn; only the visible few hold a label in the collection. */
  private labelEntries: Array<
    LabelCandidate & {
      text: string;
      font: string;
      color: Cesium.Color;
      label: Cesium.Label | null;
    }
  > = [];
  private labelPickAt = 0;
  private labelsWanted = true;
  private globeReady = false;
  private readonly labelCam = { x: NaN, y: NaN, z: NaN };
  private preRenderLabelsRemover: (() => void) | null = null;
  /** The grade's clock, so a material created after the first grade starts on it. */
  private lastGradeTime = 0;
  private readonly onError: ((message: string, error: unknown) => void) | undefined;
  private ionToken: string | undefined;
  private pickHandler: Cesium.ScreenSpaceEventHandler | null = null;
  private pickListeners = new Set<(p: GeoPoint & { viaTerrain: boolean }) => void>();
  private frameListeners = new Set<(fps: number) => void>();
  private readonly frameSampler = new FrameRateSampler();
  private readonly lastView: Cesium.Matrix4;
  private lastFps = 0;
  /** Last Mie coefficient applied (so a scrub tick does not allocate a Cartesian3 each frame). */
  private mieCoefficient: number | undefined;
  private destroyed = false;
  /** Cesium's own Mie coefficients (dome, ground atmosphere), restored when no scene asks for the physical dome. */
  private readonly defaultMie: { sky: Cesium.Cartesian3 | null; ground: Cesium.Cartesian3 };
  private overlayEntities: Cesium.Entity[] = [];
  private hiddenRunEntities: Cesium.Entity[] = [];
  private seasonEntities: Cesium.Entity[] = [];
  private nightEntities: Cesium.Entity[] = [];
  private nightKinds: Array<'moon' | 'core' | undefined> = [];
  /**
   * The overlay's geometry as last laid out: the controller keeps its paths until the day, the
   * place or the year changes, so the same arrays at the same pin and radius are not handed to
   * Cesium again (each new `ConstantProperty` rebuilt the static line batch in a worker).
   */
  private overlayLaid: {
    sunPath: unknown;
    seasonPaths: unknown;
    nightPaths: unknown;
    pinKey: string;
    radiusM: number;
  } | null = null;
  /** The map's sun marker and shadow line ends, gliding with the clock (ECEF, metres). */
  private overlaySun = new StepGlide<Vec3Like>(lerpVec3);
  private overlayShadow = new StepGlide<Vec3Like>(lerpVec3);
  private overlayBase: Cesium.Cartesian3 | null = null;
  /** The path entities the last layout showed (restored when the overlay is shown again). */
  private overlayShownPaths = new Set<Cesium.Entity>();
  /** The sun glare's direction (toward the Sun, ECEF), gliding with the clock (`setSunGlare`). */
  private sunGlare = new StepGlide<Vec3Like>(nlerpDir);
  private sunGlareLit = false;
  private sunGlareOn = false;
  private sunDirScratch: Cesium.Cartesian3 | null = null;
  /** The planets' directions, gliding with the clock, and their points (`setPlanets`). */
  private planetGlides = PLANET_SLOTS.map(() => new StepGlide<Vec3Like>(nlerpDir));
  private planetPoints: Array<HostPlanet | null> = PLANET_SLOTS.map(() => null);
  private nightMaterials: {
    moon: Cesium.PolylineDashMaterialProperty;
    core: Cesium.PolylineDashMaterialProperty;
  } | null = null;
  private baseLayer: Cesium.ImageryLayer | null = null;
  private fallbackLayer: Cesium.ImageryLayer | null = null;
  private terrainReady: Promise<void> = Promise.resolve();
  private lastCameraKey = '';
  private preRenderRemover: (() => void) | null = null;
  private preRenderGroundRemover: (() => void) | null = null;
  /** A viewpoint's measured eye height (kept above the drawn globe until that catches up). */
  private viewpointHeightM: number | null = null;
  /** The viewpoint eye's glide (`glideEyeAt`): where it is drawn, where from and where to. */
  private eyeNow: EyePosition | null = null;
  private eyeFrom: EyePosition | null = null;
  private eyeGoal: EyePosition | null = null;
  private eyeGlideStart = 0;
  private eyeGlideMs = 0;
  private eyeStepAt = 0;
  /** When the eye last settled toward its height, and how far above it the ground lifts it. */
  private eyeSettleAt = 0;
  private eyeLiftM = 0;
  /** The planner's Moon in the viewpoint's sky (`setMoonDisc`). */
  private moonDisc: HostMoonDisc | null = null;
  private moonBillboards: Cesium.BillboardCollection | null = null;
  private moonBillboard: Cesium.Billboard | null = null;
  private moonPhaseDrawn = -1;
  /** The Moon's direction, gliding with the clock (`setMoonDisc`). */
  private moonGlide = new StepGlide<Vec3Like>(nlerpDir);
  private eyeWantedM: number | null = null;
  /** The light's glide (`setLight`): the direction it is heading for, and how fast. */
  private lightGoal: Cesium.Cartesian3 | null = null;
  private lightTauMs = 100;
  private lightEaseAt = 0;
  private lightChangedAt = 0;
  /** The sky's values as last shown, and a glide between two applies (`setGrade`). */
  private gradeShown: Record<string, number> | null = null;
  private gradeFrom: Record<string, number> | null = null;
  private gradeTo: Record<string, number> | null = null;
  private gradeGlideId = 0;
  private clockGlideId = 0;
  /** The clock's glide (`setTime`). */
  private clockGoal: Cesium.JulianDate | null = null;
  private clockFrom: Cesium.JulianDate | null = null;
  private clockGlideStart = 0;
  private clockGlideMs = 100;
  private clockChangedAt = 0;

  constructor(C: CesiumModule, options: CesiumHostOptions) {
    this.C = C;
    this.onError = options.onError;
    this.ionToken = options.ionToken;
    this.detailAtlasUrl = options.groundDetailAtlasUrl;
    this.urbanAreasUrl = options.urbanAreasUrl?.replace(/\/$/, '');
    this.geoidUrl = options.geoidUrl?.replace(/\/$/, '');
    this.eyeUpScratch = new C.Cartesian3();
    this.enuScratch = newGroundFrame(C);
    if (options.ionToken) C.Ion.defaultAccessToken = options.ionToken;

    this.widget = new C.CesiumWidget(options.container, {
      baseLayer: false,
      creditContainer: options.creditContainer,
      msaaSamples: options.msaaSamples ?? 4,
      requestRenderMode: options.requestRenderMode ?? true,
      maximumRenderTimeChange: Number.POSITIVE_INFINITY,
      shadows: true,
      terrainShadows: C.ShadowMode.ENABLED,
      // No preserveDrawingBuffer: keeping the drawn frame costs the GPU a copy every frame (it
      // cannot swap buffers), the one place that reads the canvas (captureThumbnail) renders and
      // reads it in the same task, before the frame is composited and cleared.
      contextOptions: {
        webgl: { powerPreference: 'high-performance' },
      },
      shouldAnimate: false,
      // No modal "An error occurred while rendering" panel over the app (it swallowed every
      // click): `renderError` below reports the failure and the panel shows a renderer notice.
      showRenderLoopErrors: false,
    });
    this.scene = this.widget.scene;
    this.widget.useBrowserRecommendedResolution = false;

    const scene = this.scene;
    const globe = scene.globe;
    globe.enableLighting = true;
    globe.dynamicAtmosphereLighting = true;
    globe.dynamicAtmosphereLightingFromSun = false; // follow scene.light, not Cesium's sun
    globe.showGroundAtmosphere = true;
    globe.showWaterEffect = true; // needs a terrain water mask (requested below); otherwise inert
    globe.depthTestAgainstTerrain = true;
    globe.shadows = C.ShadowMode.ENABLED;
    // No tile skirts: the walls Cesium hangs under each tile's edges to hide cracks between
    // detail levels cast their own shadows, which with a low Sun drew long black lines across
    // the ground along tile edges (fjords, valleys, any slope). Cracks have not shown.
    globe.showSkirts = false;
    // A larger tile cache and the ancestors kept loaded: zooming out and back in redraws from
    // tiles already in hand instead of dropping to coarse ones and re-fetching (the "pop").
    globe.tileCacheSize = 1000;
    globe.preloadSiblings = true;
    globe.preloadAncestors = true;
    // The terrain's water mask, read through a small blur so its magnified texels draw a
    // coastline rather than a staircase (`water-mask.ts`): a patch to the surface shader set's
    // GlobeFS source, before any of its programs is built.
    {
      const set = (
        globe as unknown as {
          _surface?: {
            tileProvider?: {
              _surfaceShaderSet?: { baseFragmentShaderSource?: { sources?: string[] } };
            };
          };
        }
      )._surface?.tileProvider?._surfaceShaderSet?.baseFragmentShaderSource;
      const sources = set?.sources;
      const i = sources?.findIndex((src) => src.includes(GLOBE_MASK_SAMPLE_LINE)) ?? -1;
      const patched = sources && i >= 0 ? patchGlobeFragmentSource(sources[i]!) : null;
      if (sources && patched) sources[i] = patched;
      else options.onError?.('Water mask smoothing unavailable (Cesium shader changed)', null);
    }
    globe.baseColor = new C.Color(0.16, 0.18, 0.2, 1);
    scene.backgroundColor = new C.Color(0.02, 0.03, 0.05, 1);
    scene.atmosphere.dynamicLighting = C.DynamicAtmosphereLightingType.SCENE_LIGHT;
    this.defaultMie = {
      sky: scene.skyAtmosphere
        ? C.Cartesian3.clone(scene.skyAtmosphere.atmosphereMieCoefficient)
        : null,
      ground: C.Cartesian3.clone(scene.atmosphere.mieCoefficient),
    };
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.show = true;
      scene.skyAtmosphere.perFragmentAtmosphere = true;
    }
    scene.fog.enabled = true;
    scene.fog.density = 0.0002;
    if (scene.sun) {
      scene.sun.show = false;
      scene.sun.glowFactor = 0.4;
    }
    if (scene.moon) scene.moon.show = false;
    if (scene.skyBox) scene.skyBox.show = false;

    // Lighting from SolarState; direction is replaced on every tick.
    this.light = new C.DirectionalLight({ direction: new C.Cartesian3(0, 0, -1), intensity: 2 });
    scene.light = this.light;

    const sm = scene.shadowMap;
    sm.enabled = true;
    sm.size = 2048;
    sm.softShadows = true;
    sm.darkness = 0.4;
    sm.maximumDistance = 8000;
    // Cesium's default fades shadows out as the light nears the horizon. Low-sun shadows are the
    // whole point of this product: whether they exist is decided by `lightingFromScene`
    // (Sun above −0.833° and enough direct light), never by an aesthetic fade.
    sm.fadingEnabled = false;
    sm.normalOffset = true;
    // Buildings and trees are flat-walled primitives: with Cesium's default primitive bias their
    // walls shadow themselves in stripes (acne). A larger normal offset and depth bias clear it
    // without lifting shadows visibly off the ground (Cesium keeps these settings internal).
    const bias = (sm as unknown as { _primitiveBias?: Record<string, number | boolean> })
      ._primitiveBias;
    if (bias) {
      bias['normalOffsetScale'] = 2;
      bias['depthBias'] = 0.0002;
      // The buildings' shader divides out this fade on faces turned from the Sun.
      bias['normalShadingSmooth'] = PRIMITIVE_NORMAL_SHADING_SMOOTH;
    }

    const ssc = scene.screenSpaceCameraController;
    ssc.enableCollisionDetection = true;
    ssc.minimumZoomDistance = 2;
    ssc.maximumZoomDistance = 30_000_000;

    // Post-process grade (weather scenario). Uniforms are plain values updated per tick.
    this.gradeUniforms = {
      u_saturation: 1,
      u_contrast: 1,
      u_warmth: 0.5,
      u_tint: new C.Cartesian3(1, 1, 1),
      u_haze: 0.1,
      u_cloudCoverage: 0,
      u_cloudDensity: 0.3,
      u_cloudOpacity: 0,
      u_cloudLow: 0,
      u_cloudMid: 0,
      u_cloudHigh: 0,
      u_skyLuminance: 1,
      u_nightFactor: 0,
      u_precipitation: 0,
      u_horizonHaze: 0.1,
      u_sunElevation: 45,
      u_time: 0,
      u_sunScreen: new C.Cartesian2(-1, -1),
      u_sunVisible: 0,
      u_starField: 0,
      u_atmosphereDark: 0,
      u_sunDirEC: new C.Cartesian3(0, 0, -1),
      u_sunTint: new C.Cartesian3(1, 1, 1),
      u_moonDirEC: new C.Cartesian3(0, 0, -1),
      u_moonGlow: 0,
      u_moonRadiusDeg: 0,
      ...Object.fromEntries(PLANET_SLOTS.map((name) => [name, new C.Cartesian4(-10, -10, 0, 1)])),
      // Evaluated every frame (a function uniform): where "up" is in the view, and how high the
      // camera is — the grade tells sky from ground by the view ray, not by the depth buffer.
      u_eyeUpEC: () => {
        const cam = scene.camera;
        const up =
          C.Ellipsoid.WGS84.geodeticSurfaceNormal(cam.positionWC, this.eyeUpScratch) ??
          C.Cartesian3.clone(C.Cartesian3.UNIT_Z, this.eyeUpScratch);
        return C.Matrix4.multiplyByPointAsVector(cam.viewMatrix, up, this.eyeUpScratch);
      },
      u_eyeHeightM: () => scene.camera.positionCartographic.height,
    };
    this.grade = new C.PostProcessStage({
      fragmentShader: GRADE_FRAGMENT_SHADER,
      uniforms: this.gradeUniforms,
      name: 'lightmap-grade',
    });
    scene.postProcessStages.add(this.grade);

    // Frame-rate sampling for the quality governor (`frame-sampler.ts`): only frames drawn
    // back to back while the camera moves.
    this.lastView = new C.Matrix4();
    // The detail atlas is fetched once, up front; the material takes it when both exist.
    if (this.detailAtlasUrl) this.loadDetailAtlas(this.detailAtlasUrl);
    if (options.placeLabelsUrl) void this.loadPlaceLabels(options.placeLabelsUrl);
    this.preRenderGroundRemover = scene.preRender.addEventListener(() => {
      this.glideEye();
      this.glideLight();
      this.keepEyeAboveGlobe();
      this.placeMoonDisc();
      this.placeSunGlare();
      this.placePlanets();
      const m = this.groundMaterial;
      if (!m) return;
      const cam = scene.camera.positionWC;
      const u = m.uniforms as Record<string, unknown>;
      // Ease the detail level toward the rung's, two levels per second.
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - this.detailEaseAt) / 1000));
      this.detailEaseAt = now;
      const target = this.detailTarget;
      const current = u['u_detail'] as number;
      if (target !== null && current !== target) {
        const step = 2 * dt;
        u['u_detail'] =
          Math.abs(target - current) <= step
            ? target
            : current + Math.sign(target - current) * step;
        scene.requestRender();
      }
      // Every pattern on the ground is laid along an east/north/up frame anchored to the
      // ground: taken at an anchor point and kept until the camera has moved far from it, and
      // each frame only the camera's own position along those fixed axes goes to the shader —
      // modulo the noise's wrap, and as fractions of each detail period and the town grid, all
      // computed here in double. A frame that followed the camera would drag the pattern with it.
      const anchor = this.enuScratch.anchor;
      // Anchor at the pin when there is one (the orbit's target, the viewpoint's eye), so the
      // frame never moves while zooming; otherwise at the point under the camera, kept until
      // that has travelled far.
      const pin = this.detailAnchorTarget;
      let want: Cesium.Cartesian3 | undefined;
      if (pin) {
        if (!this.enuScratch.anchored || C.Cartesian3.distance(anchor, pin) > 1) want = pin;
      } else {
        const under = C.Ellipsoid.WGS84.scaleToGeodeticSurface(cam, new C.Cartesian3());
        if (
          under &&
          (!this.enuScratch.anchored || C.Cartesian3.distance(anchor, under) > DETAIL_REANCHOR_M)
        )
          want = under;
      }
      if (want) anchorGroundFrame(C, this.enuScratch, want, u);
      updateGroundOffsets(C, this.enuScratch, cam, u);
    });
    this.preRenderRemover = scene.postRender.addEventListener(() => {
      // Only frames drawn back to back while the camera moves say what the machine can do: the
      // scene renders on demand, so a frame drawn because a tile arrived (or the page was
      // throttled in the background) says nothing about the GPU, and counting those read as a
      // slow machine and stepped the quality down for nothing.
      const view = scene.camera.viewMatrix;
      const moving = !C.Matrix4.equalsEpsilon(view, this.lastView, 1e-9);
      C.Matrix4.clone(view, this.lastView);
      this.updateOsmBuildings();
      this.glideClock();
      const fps = this.frameSampler.frame(performance.now(), moving);
      if (fps !== null) {
        this.lastFps = fps;
        for (const l of this.frameListeners) l(fps);
      }
    });

    scene.renderError.addEventListener((_s: unknown, error: unknown) => {
      // The widget stops its render loop on an error. A globe material that fails to compile
      // on this GPU is the one failure the host can recover from: drop the texture, resume.
      if (this.groundMaterial) {
        globe.material = undefined;
        // The material destroys the textures it holds, the detail tiles among them.
        this.groundMaterial.destroy();
        this.detailTexture = null;
        this.groundMaterial = null;
        this.groundTextureFailed = true;
        this.onError?.('Ground texture disabled — the renderer could not compile it', error);
        this.widget.useDefaultRenderLoop = true;
        scene.requestRender();
        return;
      }
      this.onError?.('Renderer error', error);
    });
  }

  setTime(utc: Date): void {
    // The clock places Cesium's Sun disc, the Moon and the stars. Like the light (`setLight`), a
    // step of a few minutes (the play button, a scrub) glides over about the time between steps,
    // so the disc does not hop a quarter of a degree a minute; a jump lands at once.
    const C = this.C;
    const target = C.JulianDate.fromDate(utc);
    const clock = this.widget.clock;
    const now = performance.now();
    const from = this.clockGoal ?? clock.currentTime;
    if (C.JulianDate.equals(from, target)) return;
    const stepS = Math.abs(C.JulianDate.secondsDifference(target, clock.currentTime));
    if (stepS > CLOCK_GLIDE_MAX_S || prefersReducedMotion()) {
      clock.currentTime = target;
      this.clockGoal = null;
      this.scene.requestRender();
    } else {
      this.clockFrom = C.JulianDate.clone(clock.currentTime);
      this.clockGoal = target;
      this.clockGlideStart = now;
      const interval = now - this.clockChangedAt;
      this.clockGlideMs =
        interval <= STEP_GLIDE_MAX_MS ? Math.max(40, interval) : LONE_STEP_GLIDE_MS;
      this.clockGlideId++;
      this.scene.requestRender();
    }
    this.clockChangedAt = now;
  }

  /** One frame of the clock's glide (after the frame, so the next one draws the new time). */
  private glideClock(): void {
    const goal = this.clockGoal;
    const from = this.clockFrom;
    if (!goal || !from) return;
    const C = this.C;
    const t = Math.min(1, (performance.now() - this.clockGlideStart) / this.clockGlideMs);
    const clock = this.widget.clock;
    this.glideGrade(t);
    this.sunGlare.step(t);
    for (const g of this.planetGlides) g.step(t);
    this.moonGlide.step(t);
    this.overlaySun.step(t);
    this.overlayShadow.step(t);
    if (t >= 1) {
      clock.currentTime = goal;
      this.clockGoal = null;
    } else
      clock.currentTime = C.JulianDate.addSeconds(
        from,
        C.JulianDate.secondsDifference(goal, from) * t,
        new C.JulianDate(),
      );
    this.scene.requestRender();
  }

  setLight(light: HostLight): void {
    const C = this.C;
    const d = light.directionEcef;
    const next = C.Cartesian3.normalize(new C.Cartesian3(d.x, d.y, d.z), new C.Cartesian3());
    // The clock moves in whole minutes (the play button, a scrub), so the Sun and every shadow
    // stepped a quarter of a degree at a time, ten times a second at the default pace and twice
    // a second at the slowest. A small step now glides, over about the time between steps; a
    // jump (a new date, a long scrub) lands at once.
    const cos = C.Cartesian3.dot(next, this.light.direction);
    const now = performance.now();
    if (cos < LIGHT_GLIDE_MAX_COS || prefersReducedMotion()) {
      C.Cartesian3.clone(next, this.light.direction);
      this.lightGoal = null;
      this.lightChangedAt = now;
    } else {
      // Only a new direction counts as a step: the controller sets the light on every apply (a
      // drag, a walk step) with the same Sun, which must not shorten the glide.
      const goal = this.lightGoal ?? this.light.direction;
      if (C.Cartesian3.dot(next, goal) < 1 - 1e-12) {
        const interval = now - this.lightChangedAt;
        this.lightTauMs = Math.max(40, Math.min(300, 0.6 * interval));
        this.lightChangedAt = now;
        if (!this.lightGoal) this.lightEaseAt = now;
        this.lightGoal = next;
        this.scene.requestRender();
      }
    }
    this.light.color = new C.Color(light.color[0], light.color[1], light.color[2], 1);
    this.light.intensity = light.intensity;
  }

  setGlobeShading(shading: HostGlobeShading): void {
    const globe = this.scene.globe as Cesium.Globe | undefined;
    if (!globe) return;
    globe.enableLighting = shading.lit;
    // Every imagery layer dims together, so a provider basemap and the Natural Earth fallback
    // underneath it read as one chart.
    this.basemapBrightness = shading.basemapBrightness;
    this.applyImagerySeason();
  }

  setGroundTexture(g: HostGroundTexture | null): void {
    const C = this.C;
    const globe = this.scene.globe as Cesium.Globe | undefined;
    if (!globe) return;
    if (!g) {
      if (this.groundMaterial) {
        globe.material = undefined;
        // The material destroys the textures it holds, the detail tiles among them.
        this.groundMaterial.destroy();
        this.detailTexture = null;
        this.groundMaterial = null;
      }
      // No paint, no season on the far imagery either.
      this.snowCover = 0;
      this.applyImagerySeason();
      return;
    }
    // One material for the life of the host; its uniforms are updated in place. Cesium applies
    // a globe material only when the terrain carries vertex normals (the slope input), which
    // the terrain providers request; on the ellipsoid fallback it simply does nothing.
    if (this.groundTextureFailed) return;
    if (!this.groundMaterial) {
      // A fresh material starts with identity axes: the ground frame re-anchors on the next
      // frame so the detail atlas is projected along the real east/north/up.
      this.enuScratch.anchored = false;
      this.detailTarget = null;
      this.groundMaterial = new C.Material({
        fabric: {
          type: GROUND_MATERIAL_TYPE,
          uniforms: groundMaterialUniforms(C, this.coarseBasemap),
          source: GROUND_MATERIAL_SOURCE,
        },
        translucent: false,
        // Applies to the images the material loads itself — only the cover map, which gets no
        // mip chain: a mipmapped filter on it leaves the texture incomplete, sampling black
        // everywhere (no town ever drew). The detail tiles are textures of their own, with
        // their own mipmapped samplers.
        minificationFilter: C.TextureMinificationFilter.LINEAR,
        magnificationFilter: C.TextureMagnificationFilter.LINEAR,
      });
      globe.material = this.groundMaterial;
      this.applyNoise();
      this.applyCoverMap();
      this.applyRoadMap();
      this.applyDetailAtlas();
    }
    const u = this.groundMaterial.uniforms as Record<string, number>;
    u['u_snowlineM'] = g.snowlineM;
    u['u_treelineM'] = g.treelineM;
    u['u_poleward'] = g.poleward;
    u['u_strength'] = g.strength;
    u['u_aridity'] = g.aridity;
    u['u_ice'] = g.ice;
    u['u_brightness'] = g.brightness;
    u['u_seaLevelM'] = g.seaLevelM;
    u['u_shore'] = g.shore;
    u['u_cloudShadow'] = g.cloudShadow;
    // Eased toward in the frame loop (a rung change mid-flight fades, never switches); a fresh
    // material starts at its target.
    if (this.detailTarget === null) u['u_detail'] = g.detail;
    this.detailTarget = g.detail;
    u['u_wet'] = g.wet;
    u['u_cloudTime'] = this.lastGradeTime;
    this.leaf = {
      leafOn: g.leafOn ?? 1,
      autumn: g.autumn ?? 0,
      grassGreen: g.grassGreen ?? 1,
      deciduous: g.deciduous ?? 1,
    };
    this.snowCover = g.snowCover ?? 0;
    u['u_leafOn'] = this.leaf.leafOn;
    u['u_autumn'] = this.leaf.autumn;
    u['u_grassGreen'] = this.leaf.grassGreen;
    this.osmBuildings?.setSeason(this.leaf.leafOn, this.leaf.autumn, this.leaf.deciduous);
    this.applyImagerySeason();
    this.scene.requestRender();
  }

  /**
   * The imagery is a summer composite (Sentinel-2 cloudless): beyond the painted ground it would
   * stay green through autumn and winter. The provider's tiles take the season pixel by pixel as
   * they arrive (`imagery-season.ts`: woods turn and go bare, grass goes dormant, snow lies; water
   * and towns stay), and the layer is rebuilt when the season moves a visible step. The bundled
   * Natural Earth underneath (the coarse world, seen from orbit) only takes a gentle whole-layer
   * shift. Every layer keeps the night chart's dimming.
   */
  private applyImagerySeason(): void {
    const { leafOn, autumn, grassGreen } = this.leaf;
    const turned = autumn * leafOn;
    const winter = Math.max(1 - leafOn, 1 - grassGreen);
    const snow = this.snowCover;
    const layers = this.widget.imageryLayers;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers.get(i);
      // The base layer a season swap is replacing keeps its own per-pixel colours meanwhile.
      const perPixel =
        (layer === this.baseLayer || layer === this.retiringBase) && this.seasonalTiles;
      // czm_hue rotates the YIQ angle: green sits near -118 deg and yellow near -44, so a
      // positive turn warms greens toward yellow and orange.
      layer.hue = perPixel ? 0 : 0.22 * turned;
      layer.saturation = perPixel ? 1 : (1 + 0.12 * turned - 0.4 * winter) * (1 - 0.6 * snow);
      layer.brightness = this.basemapBrightness * (perPixel ? 1 : 1 + 0.45 * snow);
      layer.gamma = perPixel ? 1 : 1 + 0.35 * snow;
    }
    // The provider's tiles were coloured for another season: fetch them again (from the
    // browser's cache) through a fresh layer.
    const key = seasonKey(this.imagerySeason());
    if (this.baseLayer && this.seasonalTiles && key !== this.imagerySeasonKey) {
      // Once the season has held for a moment: the date slider runs through dozens of seasons
      // a second, each a full refetch and recolour of the visible tiles.
      if (this.seasonSwapTimer) clearTimeout(this.seasonSwapTimer);
      this.seasonSwapTimer = setTimeout(() => {
        this.seasonSwapTimer = null;
        this.swapSeasonLayer();
      }, SEASON_SWAP_SETTLE_MS);
    }
  }

  /**
   * A fresh base imagery layer for the current season, drawn under the old one, which is kept
   * until the new one's tiles are in: removed at once, the globe flashed to the coarse fallback
   * underneath for as long as the tiles took to come back.
   */
  private swapSeasonLayer(): void {
    if (this.destroyed || !this.baseLayer) return;
    const key = seasonKey(this.imagerySeason());
    if (key === this.imagerySeasonKey) return;
    this.imagerySeasonKey = key;
    const layers = this.widget.imageryLayers;
    // A previous swap still waiting: its old layer goes now.
    this.retireLayer?.();
    const old = this.baseLayer;
    const index = layers.indexOf(old);
    const layer = new this.C.ImageryLayer(old.imageryProvider);
    layer.errorEvent.addEventListener((err: unknown) =>
      this.onError?.('Imagery tile failed — Natural Earth II shown underneath', err),
    );
    layer.brightness = this.basemapBrightness;
    // Under the old layer: it keeps covering while the new one loads (coarse parents first,
    // then the detail), and its removal reveals the new season at full detail in one step.
    layers.add(layer, index);
    this.baseLayer = layer;
    const globe = this.scene.globe as Cesium.Globe | undefined;
    let removeListener: (() => void) | null = null;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    const retire = () => {
      removeListener?.();
      if (fallback) clearTimeout(fallback);
      if (this.retireLayer === retire) {
        this.retireLayer = null;
        this.retiringBase = null;
      }
      if (this.destroyed) return;
      if (layers.contains(old)) layers.remove(old, false);
      this.scene.requestRender();
    };
    this.retireLayer = retire;
    this.retiringBase = old;
    removeListener =
      globe?.tileLoadProgressEvent.addEventListener((queued: number) => {
        if (queued === 0) retire();
      }) ?? null;
    // While the camera keeps moving the queue may never empty: the new season shows anyway.
    fallback = setTimeout(retire, 4000);
    this.scene.requestRender();
  }

  private readonly seasonQueue = new FrameBudgetQueue({ budgetMs: 6 });

  private imagerySeason(): ImagerySeason {
    return { ...this.leaf, snow: this.snowCover };
  }

  /**
   * Has an imagery provider's tiles take the season as they arrive (read into a canvas,
   * recoloured, handed on). A tile that cannot be read (a host without CORS) stays as it is.
   */
  private seasonalise(provider: Cesium.ImageryProvider): void {
    const request = provider.requestImage.bind(provider);
    provider.requestImage = (x, y, level, req) => {
      const job = request(x, y, level, req);
      if (!job) return job;
      // Recoloured a frame's budget at a time: tiles land in bursts while the camera moves.
      return job.then((image) =>
        seasonShows(this.imagerySeason())
          ? this.seasonQueue.run(() => this.seasonTile(image, x, y))
          : image,
      );
    };
    this.seasonalTiles = true;
  }

  private seasonTile<T>(image: T, x: number, y: number): T | HTMLCanvasElement {
    const season = this.imagerySeason();
    if (!seasonShows(season)) return image;
    try {
      const src = image as unknown as CanvasImageSource & { width: number; height: number };
      const w = src.width;
      const h = src.height;
      if (!w || !h) return image;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return image;
      ctx.drawImage(src, 0, 0);
      const data = ctx.getImageData(0, 0, w, h);
      seasonalisePixels(data.data, w, season, x * w, y * h);
      ctx.putImageData(data, 0, 0);
      return canvas;
    } catch {
      return image;
    }
  }

  setShadows(s: HostShadows): void {
    const sm = this.scene.shadowMap;
    sm.enabled = s.enabled;
    sm.darkness = s.darkness;
    if (sm.size !== s.size) sm.size = s.size;
    if (sm.softShadows !== s.softShadows) sm.softShadows = s.softShadows;
    if (Math.abs(sm.maximumDistance - s.maximumDistance) > 1)
      sm.maximumDistance = s.maximumDistance;
    this.osmBuildings?.setShadowMap(sm.enabled, sm.darkness, sm.maximumDistance);
  }

  setAtmosphere(a: HostAtmosphere): void {
    const scene = this.scene;
    const sky = scene.skyAtmosphere;
    if (sky) {
      sky.hueShift = a.hueShift;
      sky.saturationShift = a.saturationShift;
      sky.brightnessShift = a.brightnessShift;
      sky.atmosphereLightIntensity = a.lightIntensity;
    }
    // `scene.globe` is undefined once the scene is destroyed (and when a host runs without one).
    const globe = scene.globe as Cesium.Globe | undefined;
    if (globe) {
      globe.atmosphereHueShift = a.hueShift;
      globe.atmosphereSaturationShift = a.saturationShift;
      globe.atmosphereBrightnessShift = a.brightnessShift;
    }
    scene.atmosphere.hueShift = a.hueShift;
    scene.atmosphere.saturationShift = a.saturationShift;
    scene.atmosphere.brightnessShift = a.brightnessShift;
    scene.fog.density = a.fogDensity;
    if (a.mieCoefficient !== this.mieCoefficient) {
      // Same aerosol density for the dome and the ground atmosphere (wavelength-independent);
      // Cesium's own value comes back when a scene stops asking for one.
      this.mieCoefficient = a.mieCoefficient;
      const m = a.mieCoefficient;
      const C = this.C;
      if (sky) {
        const skyMie = m === undefined ? this.defaultMie.sky : new C.Cartesian3(m, m, m);
        if (skyMie) sky.atmosphereMieCoefficient = C.Cartesian3.clone(skyMie);
      }
      scene.atmosphere.mieCoefficient = C.Cartesian3.clone(
        m === undefined ? this.defaultMie.ground : new C.Cartesian3(m, m, m),
      );
    }
  }

  setGrade(u: HostGradeUniforms): void {
    const g = this.gradeUniforms;
    // The ground's cloud shadows drift with the same clock as the sky's clouds.
    this.lastGradeTime = u.u_time;
    if (this.groundMaterial)
      (this.groundMaterial.uniforms as Record<string, number>)['u_cloudTime'] = u.u_time;
    g['u_saturation'] = u.u_saturation;
    g['u_contrast'] = u.u_contrast;
    g['u_warmth'] = u.u_warmth;
    (g['u_tint'] as Cesium.Cartesian3).x = u.u_tint[0];
    (g['u_tint'] as Cesium.Cartesian3).y = u.u_tint[1];
    (g['u_tint'] as Cesium.Cartesian3).z = u.u_tint[2];
    g['u_haze'] = u.u_haze;
    g['u_cloudCoverage'] = u.u_cloudCoverage;
    g['u_cloudDensity'] = u.u_cloudDensity;
    g['u_cloudOpacity'] = u.u_cloudOpacity;
    g['u_cloudLow'] = u.u_cloudLow;
    g['u_cloudMid'] = u.u_cloudMid;
    g['u_cloudHigh'] = u.u_cloudHigh;
    g['u_skyLuminance'] = u.u_skyLuminance;
    g['u_nightFactor'] = u.u_nightFactor;
    g['u_precipitation'] = u.u_precipitation;
    g['u_horizonHaze'] = u.u_horizonHaze;
    g['u_sunElevation'] = u.u_sunElevation;
    g['u_time'] = u.u_time;
    (g['u_sunScreen'] as Cesium.Cartesian2).x = u.u_sunScreen[0];
    (g['u_sunScreen'] as Cesium.Cartesian2).y = u.u_sunScreen[1];
    g['u_sunVisible'] = u.u_sunVisible;
    // PostProcessStage copies uniform values on assignment; write them through.
    const target = this.grade.uniforms as Record<string, unknown>;
    // Function uniforms (evaluated per frame) become read-only properties once the stage holds
    // them; only the values are written through.
    // While the clock glides a minute step (`setTime`), the sky's time-driven values glide with
    // it from what is shown now, so the dome, the twilight colours and the drifting clouds do
    // not step a minute at a time either.
    const shown = this.gradeShown;
    if (this.clockGoal && shown && this.clockGlideId !== this.gradeGlideId) {
      // A new step began this apply: glide from what is on screen to the new values.
      this.gradeGlideId = this.clockGlideId;
      const from: Record<string, number> = {};
      const to: Record<string, number> = {};
      for (const key of GRADE_GLIDE_KEYS) {
        const a = shown[key];
        const b = g[key];
        // The cloud clock wraps every ~69 days: across the wrap it hops, not sweeps back.
        if (
          typeof a === 'number' &&
          typeof b === 'number' &&
          !(key === 'u_time' && Math.abs(b - a) > 15)
        ) {
          from[key] = a;
          to[key] = b;
        }
      }
      this.gradeFrom = from;
      this.gradeTo = to;
    } else if (this.clockGoal && this.gradeFrom && this.gradeTo) {
      // The same step re-applied (a drag while the day plays): only its end may move.
      for (const key of Object.keys(this.gradeTo)) {
        const b = g[key];
        if (typeof b === 'number') this.gradeTo[key] = b;
      }
    } else this.gradeFrom = null;
    // What is on screen is kept here, not read back from the stage: once Cesium has built its
    // uniform map the stage's `uniforms` are accessors onto `g` (already the new values).
    const onScreen = this.gradeShown ?? {};
    for (const key of Object.keys(g)) {
      const v = g[key];
      if (typeof v === 'function') continue;
      // Gliding values stay as shown; the glide (after each frame) moves them on.
      if (this.gradeFrom && key in this.gradeFrom) continue;
      target[key] = v;
      if (typeof v === 'number') onScreen[key] = v;
    }
    if (this.groundMaterial && this.gradeFrom)
      (this.groundMaterial.uniforms as Record<string, number>)['u_cloudTime'] =
        shown?.['u_time'] ?? u.u_time;
    this.gradeShown = onScreen;
  }

  /** The sky's glide, at the clock glide's own fraction `t` (0-1). */
  private glideGrade(t: number): void {
    const from = this.gradeFrom;
    const to = this.gradeTo;
    if (!from || !to) return;
    const target = this.grade.uniforms as Record<string, unknown>;
    const shown = this.gradeShown ?? {};
    for (const key of Object.keys(from)) {
      const a = from[key] as number;
      const b = to[key] as number;
      const v = a + (b - a) * t;
      target[key] = v;
      shown[key] = v;
      if (key === 'u_time' && this.groundMaterial)
        (this.groundMaterial.uniforms as Record<string, number>)['u_cloudTime'] = v;
    }
    this.gradeShown = shown;
    if (t >= 1) this.gradeFrom = null;
  }

  /**
   * A viewpoint is placed at the height the controller measured, which lags a move to a new
   * place by the time the finest terrain takes to load: in between the eye could sit under the
   * ground drawn (V&V: Moab, 1 250 m above the last place, ten seconds of terrain seen from
   * below). Until then the eye stands on the globe as drawn.
   */
  /** One frame of the light's glide toward the Sun's latest direction (`setLight`). */
  private glideLight(): void {
    const goal = this.lightGoal;
    if (!goal) return;
    const C = this.C;
    const t = performance.now();
    const dt = Math.min(100, t - this.lightEaseAt);
    this.lightEaseAt = t;
    const k = 1 - Math.exp(-dt / this.lightTauMs);
    const dir = this.light.direction;
    C.Cartesian3.lerp(dir, goal, k, dir);
    C.Cartesian3.normalize(dir, dir);
    if (C.Cartesian3.dot(dir, goal) > 1 - 1.5e-8) {
      // Within ~0.01°: there.
      C.Cartesian3.clone(goal, dir);
      this.lightGoal = null;
    } else this.scene.requestRender();
  }

  /** One frame of the viewpoint eye's glide toward its goal; keeps frames coming until there. */
  private glideEye(): void {
    const from = this.eyeFrom;
    const goal = this.eyeGoal;
    if (!from || !goal) return;
    const step = glideEyeAt(from, goal, performance.now() - this.eyeGlideStart, this.eyeGlideMs);
    this.eyeNow = step.eye;
    if (step.done) this.eyeGoal = null;
    else this.scene.requestRender();
    const cam = this.scene.camera;
    this.viewpointHeightM = step.eye.heightM;
    cam.setView({
      destination: this.C.Cartesian3.fromDegrees(
        step.eye.longitude,
        step.eye.latitude,
        step.eye.heightM,
      ),
      orientation: { heading: cam.heading, pitch: cam.pitch, roll: 0 },
    });
  }

  private keepEyeAboveGlobe(): void {
    const wanted = this.viewpointHeightM;
    if (wanted === null) return;
    const cam = this.scene.camera;
    const carto = cam.positionCartographic;
    const surface = (this.scene.globe as Cesium.Globe | undefined)?.getHeight(carto);
    // The ground's lift over the wanted height (`eyeLift`), kept as a lift rather than a camera
    // height so a walk's glide, which sets the camera to the wanted height every frame, does not
    // undo it.
    const t = performance.now();
    const gap = t - this.eyeSettleAt;
    // After a pause (the scene draws on demand) count one ordinary frame, not the whole pause.
    const dt = gap > 50 ? 16 : Math.max(0, gap);
    this.eyeSettleAt = t;
    const next = eyeLift(
      { liftM: this.eyeLiftM, wantedM: this.eyeWantedM },
      wanted,
      surface !== undefined && Number.isFinite(surface) ? surface : null,
      dt,
    );
    this.eyeLiftM = next.liftM;
    this.eyeWantedM = wanted;
    if (next.settling) this.scene.requestRender();
    const lift = next.liftM;
    const height = wanted + lift;
    if (Math.abs(carto.height - height) < 0.01) return;
    const C = this.C;
    cam.setView({
      destination: C.Cartesian3.fromRadians(carto.longitude, carto.latitude, height),
      orientation: { heading: cam.heading, pitch: cam.pitch, roll: 0 },
    });
  }

  setCamera(c: HostCamera): void {
    const C = this.C;
    const cam = this.scene.camera;
    const ssc = this.scene.screenSpaceCameraController;
    const key = JSON.stringify(c);
    if (key === this.lastCameraKey) return;
    this.lastCameraKey = key;
    const pin = c.kind === 'viewpoint' ? c.eye : c.target;
    this.detailAnchorTarget = C.Cartesian3.fromDegrees(pin.longitude, pin.latitude, 0);
    this.setLabelsForCamera(c.kind);
    const wasViewpoint = this.viewpointHeightM !== null;
    this.viewpointHeightM = c.kind === 'viewpoint' ? c.heightM : null;
    if (c.kind === 'viewpoint') {
      ssc.enableInputs = false; // React layer handles drag-to-look via CameraState
      // A flight still under way (to the place's orbit view) would carry on over this view.
      cam.cancelFlight();
      cam.lookAtTransform(C.Matrix4.IDENTITY);
      const frustum = cam.frustum;
      if (frustum instanceof C.PerspectiveFrustum) frustum.fov = c.fovDeg * DEG;
      // A step of the eye (W A S D, the height a terrain look-up settles on) glides there over
      // a few frames; a new place, or a reader who asks for less motion, lands at once. The
      // look direction always changes at once: the sky overlays follow it exactly.
      const goal: EyePosition = {
        longitude: c.eye.longitude,
        latitude: c.eye.latitude,
        heightM: c.heightM,
      };
      const from = this.eyeNow;
      const glide =
        from !== null &&
        wasViewpoint &&
        !prefersReducedMotion() &&
        eyeDistanceM(from, goal) < EYE_EASE_MAX_M;
      const t = performance.now();
      // The same eye with a new look direction (a drag) is not a step: a glide under way goes on.
      const sameGoal = eyeDistanceM(this.eyeGoal ?? from ?? goal, goal) < 0.01;
      if (glide && sameGoal) {
        if (this.eyeGoal) this.viewpointHeightM = from.heightM;
      } else if (glide) {
        // From where it is drawn now, taking as long as the steps are coming apart.
        this.eyeFrom = from;
        this.eyeGoal = goal;
        this.eyeGlideStart = t;
        this.eyeGlideMs = eyeGlideDurationMs(t - this.eyeStepAt);
        this.viewpointHeightM = from.heightM;
        this.eyeStepAt = t;
      } else {
        this.eyeNow = goal;
        this.eyeFrom = null;
        this.eyeGoal = null;
        this.eyeStepAt = t;
        this.eyeLiftM = 0;
      }
      const at = this.eyeNow ?? goal;
      cam.setView({
        destination: C.Cartesian3.fromDegrees(at.longitude, at.latitude, at.heightM),
        orientation: { heading: c.headingDeg * DEG, pitch: c.pitchDeg * DEG, roll: 0 },
      });
      this.scene.requestRender();
    } else {
      this.eyeNow = null;
      this.eyeFrom = null;
      this.eyeGoal = null;
      ssc.enableInputs = true;
      ssc.enableTranslate = true;
      ssc.enableRotate = true;
      ssc.enableTilt = true;
      ssc.enableZoom = true;
      ssc.enableLook = false;
      const frustum = cam.frustum;
      if (frustum instanceof C.PerspectiveFrustum) frustum.fov = 60 * DEG;
      // Clear of the ground first: an orbit's camera, set back along a shallow pitch, can land
      // inside a valley wall (Yosemite), and then nothing at all is drawn. The pitch steepens
      // until the camera and its sight line clear the terrain; the move waits for the check.
      const key0 = key;
      void this.clearPitch(c).then((pitchDeg) => {
        if (this.destroyed || key0 !== this.lastCameraKey) return;
        this.orbitTo(c, pitchDeg);
      });
    }
  }

  /** The orbit's pitch, steepened as needed to keep the camera clear of the terrain. */
  private async clearPitch(c: HostOrbitCamera): Promise<number> {
    const candidates = steeperPitches(c.pitchDeg).map((p) => ({
      pitchDeg: p,
      line: orbitSightLine(
        { latitude: c.target.latitude, longitude: c.target.longitude, heightM: c.targetHeightM },
        c.headingDeg,
        p,
        c.rangeM,
      ),
    }));
    // Only worth asking where an orbit is close enough to meet the ground.
    if (c.rangeM > 60_000) return c.pitchDeg;
    const pts = candidates.flatMap((cand) => cand.line);
    let heights: Array<number | null>;
    try {
      heights = await Promise.race([
        this.sampleGroundHeights(pts, 13),
        new Promise<Array<number | null>>((r) => setTimeout(() => r(pts.map(() => null)), 2500)),
      ]);
    } catch {
      return c.pitchDeg;
    }
    const per = candidates[0]?.line.length ?? 0;
    return clearOrbitPitch(c.pitchDeg, candidates, (ci, pi) => heights[ci * per + pi] ?? null);
  }

  private orbitTo(c: HostOrbitCamera, pitchDeg: number): void {
    const C = this.C;
    const cam = this.scene.camera;
    {
      const target = C.Cartesian3.fromDegrees(
        c.target.longitude,
        c.target.latitude,
        c.targetHeightM,
      );
      const offset = new C.HeadingPitchRange(c.headingDeg * DEG, pitchDeg * DEG, c.rangeM);
      // A flight still under way (to this place, before its ground height was known) would
      // carry on to its old end and overwrite a correction made now; so a correction during a
      // flight becomes a short flight to the corrected view instead.
      const flying = (cam as unknown as { _currentFlight?: unknown })._currentFlight !== undefined;
      if (c.fly || flying) {
        cam.cancelFlight();
        cam.lookAtTransform(C.Matrix4.IDENTITY);
        const sphere = new C.BoundingSphere(target, Math.max(1, c.rangeM * 0.15));
        // Cesium sizes the flight to the distance (a hop along a coast is quick, orbit to a
        // street several seconds), which gives the terrain time to load on the way in.
        cam.flyToBoundingSphere(sphere, {
          offset,
          maximumHeight: Math.max(c.rangeM * 4, 2e6),
          ...(c.fly ? {} : { duration: 1 }),
        });
      } else {
        cam.lookAt(target, offset);
        cam.lookAtTransform(C.Matrix4.IDENTITY); // release so the user can orbit freely
      }
    }
  }

  setOverlay(o: HostOverlay): void {
    const C = this.C;
    const ents = this.widget.entities;
    if (!o.visible || !o.pin) {
      for (const e of this.overlayEntities) e.show = false;
      for (const e of this.hiddenRunEntities) e.show = false;
      for (const e of this.seasonEntities) e.show = false;
      for (const e of this.nightEntities) e.show = false;
      return;
    }
    const pin = o.pin;
    const base = C.Cartesian3.fromDegrees(pin.longitude, pin.latitude, pin.heightM);
    const enu = C.Transforms.eastNorthUpToFixedFrame(base);
    const local = (azDeg: number, elDeg: number, r: number): Cesium.Cartesian3 => {
      const az = azDeg * DEG;
      const el = elDeg * DEG;
      const v = new C.Cartesian3(
        r * Math.cos(el) * Math.sin(az),
        r * Math.cos(el) * Math.cos(az),
        r * Math.sin(el),
      );
      return C.Matrix4.multiplyByPoint(enu, v, new C.Cartesian3());
    };
    // Entities are created once and updated in place; add/remove per scrub tick was measurable.
    if (this.overlayEntities.length === 0) {
      const gold = C.Color.fromCssColorString('#f5b342');
      // The sun marker, its ray and the shadow line move every minute step: they read the
      // gliding ends each frame (Cesium draws such lines from a polyline collection, updated in
      // place), while the day's paths below stay static geometry, laid out once per day.
      // Scratch ends, reused every frame (Cesium copies a line's positions as it reads them).
      const cart = (
        v: Vec3Like | null,
        out: Cesium.Cartesian3 = new C.Cartesian3(),
      ): Cesium.Cartesian3 | undefined =>
        v ? C.Cartesian3.fromElements(v.x, v.y, v.z, out) : undefined;
      const line = (end: StepGlide<Vec3Like>) => {
        const tip = new C.Cartesian3();
        const pair: Cesium.Cartesian3[] = [];
        return new C.CallbackProperty(() => {
          const a = this.overlayBase;
          const b = cart(end.shown, tip);
          if (!a || !b) return undefined;
          pair[0] = a;
          pair[1] = b;
          return pair;
        }, false);
      };
      const marker = new C.Cartesian3();
      this.overlayEntities = [
        ents.add({
          point: {
            pixelSize: 14,
            color: C.Color.fromCssColorString('#f4f4f5'),
            outlineColor: C.Color.fromCssColorString('#0b0b0d'),
            outlineWidth: 5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
        ents.add({
          polyline: { width: 3, material: gold.withAlpha(0.85), arcType: C.ArcType.NONE },
        }),
        ents.add({
          position: new C.CallbackPositionProperty(
            (_t: unknown, result?: Cesium.Cartesian3) =>
              cart(this.overlaySun.shown, result ?? marker),
            false,
          ),
          point: {
            pixelSize: 18,
            color: gold,
            outlineColor: C.Color.fromCssColorString('#7a4a00'),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
        ents.add({
          polyline: {
            positions: line(this.overlaySun),
            width: 2,
            material: new C.PolylineDashMaterialProperty({
              color: gold.withAlpha(0.7),
              dashLength: 12,
            }),
            arcType: C.ArcType.NONE,
          },
        }),
        ents.add({
          polyline: {
            positions: line(this.overlayShadow),
            width: 6,
            material: C.Color.fromCssColorString('#0b0b0d').withAlpha(0.6),
            arcType: C.ArcType.NONE,
          },
        }),
      ];
      // Runs of the sun path that lie behind the terrain horizon: dark dashes drawn over the
      // gold path. A small pool; a day rarely has more than a few hidden spells.
      for (let i = 0; i < HIDDEN_RUN_POOL; i++)
        this.hiddenRunEntities.push(
          ents.add({
            show: false,
            polyline: {
              width: 5,
              material: new C.PolylineDashMaterialProperty({
                color: C.Color.fromCssColorString('#0b0b0d').withAlpha(0.75),
                gapColor: C.Color.TRANSPARENT,
                dashLength: 10,
              }),
              arcType: C.ArcType.NONE,
            },
          }),
        );
    }
    const [pinE, pathE, sunE, rayE, shadowE] = this.overlayEntities as [
      Cesium.Entity,
      Cesium.Entity,
      Cesium.Entity,
      Cesium.Entity,
      Cesium.Entity,
    ];
    const pinKey = `${pin.longitude}|${pin.latitude}|${pin.heightM}`;
    const laid = this.overlayLaid;
    const pinMoved = !laid || laid.pinKey !== pinKey || laid.radiusM !== o.radiusM;
    if (pinMoved) {
      pinE.position = new C.ConstantPositionProperty(base);
      this.overlayBase = base;
    }
    pinE.show = true;
    // The sun marker and the shadow line glide with the clock's minute steps, like the light;
    // a new pin, a new radius or a Sun just risen lands at once.
    const stepId = pinMoved ? null : this.clockStepId;
    if (o.sun) {
      this.overlaySun.set(
        local(o.sun.azimuthDeg, o.sun.elevationDeg, o.radiusM),
        sunE.show ? stepId : null,
      );
      sunE.show = true;
      rayE.show = true;
    } else {
      sunE.show = false;
      rayE.show = false;
    }
    if (o.shadowAzimuthDeg !== null) {
      this.overlayShadow.set(
        local(o.shadowAzimuthDeg, 0.5, Math.min(o.radiusM * 0.5, 200)),
        shadowE.show ? stepId : null,
      );
      shadowE.show = true;
    } else shadowE.show = false;
    // The day's, the year's and the night's paths: laid out again only when they change.
    if (
      laid &&
      !pinMoved &&
      laid.sunPath === o.sunPath &&
      laid.seasonPaths === o.seasonPaths &&
      laid.nightPaths === o.nightPaths
    ) {
      // Hidden by an earlier `visible: false`: shown again as they were.
      for (const e of [
        pathE,
        ...this.seasonEntities,
        ...this.nightEntities,
        ...this.hiddenRunEntities,
      ])
        e.show = this.overlayShownPaths.has(e);
      return;
    }
    this.overlayLaid = {
      sunPath: o.sunPath,
      seasonPaths: o.seasonPaths,
      nightPaths: o.nightPaths,
      pinKey,
      radiusM: o.radiusM,
    };
    if (o.sunPath.length > 1) {
      pathE.polyline!.positions = new C.ConstantProperty(
        o.sunPath.map((s) => local(s.azimuthDeg, s.elevationDeg, o.radiusM)),
      );
      pathE.show = true;
    } else pathE.show = false;
    // Solstice arcs: thin and faint, one entity per path, created on first use.
    while (this.seasonEntities.length < o.seasonPaths.length)
      this.seasonEntities.push(
        ents.add({
          show: false,
          polyline: {
            width: 1.5,
            material: C.Color.fromCssColorString('#f5b342').withAlpha(0.35),
            arcType: C.ArcType.NONE,
          },
        }),
      );
    this.seasonEntities.forEach((e, i) => {
      const path = o.seasonPaths[i];
      if (path && path.length > 1) {
        e.polyline!.positions = new C.ConstantProperty(
          path.map((s) => local(s.azimuthDeg, s.elevationDeg, o.radiusM)),
        );
        e.show = true;
      } else e.show = false;
    });
    // Night paths (moon planning): the Moon's path while up in grey, the Milky Way core's track
    // through the dark hours in violet — dashed, one entity per run, pooled and restyled per use.
    while (this.nightEntities.length < o.nightPaths.length)
      this.nightEntities.push(
        ents.add({
          show: false,
          polyline: { width: 2, arcType: C.ArcType.NONE },
        }),
      );
    // Two shared dash materials, assigned only when an entity's kind changes (a material
    // assignment makes the visualizer rebuild); positions follow the radius like the sun's.
    const materials = (this.nightMaterials ??= {
      moon: new C.PolylineDashMaterialProperty({
        color: C.Color.fromCssColorString('#d8dde6').withAlpha(0.55),
        gapColor: C.Color.TRANSPARENT,
        dashLength: 8,
      }),
      core: new C.PolylineDashMaterialProperty({
        color: C.Color.fromCssColorString('#c9b8ff').withAlpha(0.7),
        gapColor: C.Color.TRANSPARENT,
        dashLength: 8,
      }),
    });
    this.nightEntities.forEach((e, i) => {
      const np = o.nightPaths[i];
      if (np && np.points.length > 1) {
        e.polyline!.positions = new C.ConstantProperty(
          np.points.map((s) => local(s.azimuthDeg, s.elevationDeg, o.radiusM)),
        );
        if (this.nightKinds[i] !== np.kind) {
          e.polyline!.material = materials[np.kind];
          this.nightKinds[i] = np.kind;
        }
        e.show = true;
      } else e.show = false;
    });
    // Hidden runs: consecutive points marked behindTerrain, extended by one point on each side so
    // the dashes meet the gold path where the sun clears the ridge.
    const runs: Array<Cesium.Cartesian3[]> = [];
    let run: Cesium.Cartesian3[] | null = null;
    o.sunPath.forEach((s, i) => {
      if (s.behindTerrain) {
        if (!run) {
          run = [];
          const prev = o.sunPath[i - 1];
          if (prev) run.push(local(prev.azimuthDeg, prev.elevationDeg, o.radiusM));
        }
        run.push(local(s.azimuthDeg, s.elevationDeg, o.radiusM));
      } else if (run) {
        run.push(local(s.azimuthDeg, s.elevationDeg, o.radiusM));
        runs.push(run);
        run = null;
      }
    });
    if (run) runs.push(run);
    this.hiddenRunEntities.forEach((e, i) => {
      const r = runs[i];
      if (r && r.length > 1 && o.visible) {
        e.polyline!.positions = new C.ConstantProperty(r);
        e.show = true;
      } else e.show = false;
    });
    this.overlayShownPaths = new Set(
      [pathE, ...this.seasonEntities, ...this.nightEntities, ...this.hiddenRunEntities].filter(
        (e) => e.show,
      ),
    );
  }

  /** The clock step under way (`setTime`), for values that glide with it; null when none. */
  private get clockStepId(): number | null {
    return this.clockGoal ? this.clockGlideId : null;
  }

  setQuality(q: HostQuality): void {
    this.scene.globe.maximumScreenSpaceError = q.terrainScreenSpaceError;
    // Buildings follow the same rung: their tiles are refined to the same screen-space error.
    if (this.buildings)
      this.buildings.maximumScreenSpaceError = Math.max(8, q.terrainScreenSpaceError * 6);
    // The free buildings: on the Battery and Minimal rungs, no trees and no skyline ring.
    this.osmBuildings?.setLean(q.terrainScreenSpaceError >= 4);
    this.osmLean = q.terrainScreenSpaceError >= 4;
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    this.widget.resolutionScale = Math.min(q.resolutionScale, 2 / dpr);
    // Fewer samples on the cheap rungs (the framebuffers are rebuilt once, on the change); with
    // MSAA off, FXAA keeps the edges from stair-stepping at a fraction of the cost.
    const msaa = q.msaaSamples ?? 4;
    if (this.scene.msaaSamples !== msaa) this.scene.msaaSamples = msaa;
    // What the context granted (WebGL 1 has no MSAA at all): FXAA wherever it is off.
    this.scene.postProcessStages.fxaa.enabled = this.scene.msaaSamples <= 1;
    this.scene.requestRender();
  }

  setIonToken(token: string | undefined): void {
    this.ionToken = token;
    if (token) this.C.Ion.defaultAccessToken = token;
  }

  /**
   * With no land-cover source: the bundled urban areas around the pin, filled into a cover map
   * as built-up ground, and — where the OpenStreetMap vector tiles answer — the mapped land use,
   * land cover and water painted over them (parks, woods, fields, sand, water; everything else
   * stays unknown, so the procedural rules hold there).
   */
  private async loadUrbanAround(p: GeoPoint): Promise<LandCoverReading | null> {
    if (this.destroyed) return null;
    const seq = ++this.coverLoadSeq;
    const mosaic = coverMosaicFor(p, 12);
    const polys: UrbanPolygon[] = [];
    const base = this.urbanAreasUrl;
    if (base) {
      this.urbanIndex ??= fetch(`${base}/index.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: unknown) =>
          j && typeof j === 'object' && Array.isArray((j as { cells?: unknown }).cells)
            ? new Set(
                (j as { cells: unknown[] }).cells.filter((c): c is string => typeof c === 'string'),
              )
            : null,
        )
        .catch(() => null);
      const index = await this.urbanIndex;
      if (!index) this.urbanIndex = null; // try again next time
      const keys = index ? urbanCellsFor(mosaicBox(mosaic)).filter((k) => index.has(k)) : [];
      for (const key of keys) {
        let cell = this.urbanCells.get(key);
        if (!cell) {
          cell = fetch(`${base}/${key}.json`)
            .then((r) => (r.ok ? r.json() : null))
            .then((j: unknown) => decodeUrbanCell(j, key))
            .catch(() => []);
          this.urbanCells.set(key, cell);
        }
        polys.push(...(await cell));
      }
    }
    // OpenStreetMap's own cover, from the same vector tiles as the buildings.
    const shapes: { cls: Parameters<typeof packCover>[0]; rings: [number, number][][] }[] = [];
    const template = this.osmBuildings ? await this.osmBuildings.tileTemplate() : null;
    if (template) {
      void this.loadStreetsAround(p, template);
      const jobs: Promise<void>[] = [];
      for (let y = mosaic.y0; y <= mosaic.y1; y++)
        for (let x = mosaic.x0; x <= mosaic.x1; x++)
          jobs.push(
            fetch(tileUrl(template, mosaic.zoom, x, y))
              .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
              .then((data) => {
                if (data) shapes.push(...coverShapesFromTile(data, mosaic.zoom, x, y));
              })
              .catch(() => undefined),
          );
      await Promise.all(jobs);
    }
    if (this.destroyed || seq !== this.coverLoadSeq) return null;
    if (polys.length === 0 && shapes.length === 0) return null;
    // Finer texels when OpenStreetMap's polygons are drawn (a park or a block is ~100 m).
    const TILE = shapes.length > 0 ? 512 : 256;
    const width = (mosaic.x1 - mosaic.x0 + 1) * TILE;
    const height = (mosaic.y1 - mosaic.y0 + 1) * TILE;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const fill = (
      rings: readonly (readonly [number, number])[][],
      cls: Parameters<typeof packCover>[0],
    ) => {
      const [r, g, b] = packCover(cls);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], i) => {
          const [x, y] = mosaicPixel(mosaic, width, height, lon, lat);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    };
    for (const poly of polys) fill(poly, 'built');
    for (const s of shapes) fill(s.rings, s.cls);
    // Shares of the map by what it holds (alpha marks known texels).
    const data = ctx.getImageData(0, 0, width, height).data;
    let known = 0;
    let built = 0;
    let trees = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 128) continue;
      known++;
      if ((data[i + 1] ?? 0) >= 128) built++;
      else if ((data[i] ?? 0) >= 200) trees++;
    }
    const total = width * height;
    if (this.destroyed || seq !== this.coverLoadSeq) return null;
    this.coverCanvas = known > 0 ? canvas : null;
    this.coverBounds =
      known > 0 ? [mosaic.westRad, mosaic.eastRad, mosaic.northMerc, mosaic.southMerc] : null;
    this.applyCoverMap();
    const r3 = (v: number, of: number) => Math.round((v / of) * 1000) / 1000;
    const shares: Record<string, number> = {};
    if (built > 0) shares['built'] = r3(built, known);
    if (trees > 0) shares['tree'] = r3(trees, known);
    return {
      known: r3(known, total),
      shares,
      metresPerPixel: (mosaic.metresPerPixel * 256) / TILE,
    };
  }

  setLandCover(d: LandCoverDescriptor): void {
    if (JSON.stringify(d) === JSON.stringify(this.landCover)) return;
    this.landCover = d;
    // A new source (or none): whatever map was loaded is from the old one.
    this.coverLoadSeq++;
    this.coverBounds = null;
    this.coverCanvas = null;
    this.applyCoverMap();
  }

  /**
   * Put the loaded cover map (or its absence) into the material's uniforms. A new image
   * uniform is uploaded during the next render (the material would sample the default white
   * texture that frame), so the on-flag follows one render later, with a render requested
   * for it.
   */
  private applyCoverMap(): void {
    const C = this.C;
    if (!this.groundMaterial) return;
    const u = this.groundMaterial.uniforms as Record<string, unknown>;
    if (this.coverBounds && this.coverCanvas) {
      const [w, e, n, so] = this.coverBounds;
      u[GROUND_COVER_BOUNDS_UNIFORM] = new C.Cartesian4(w, e, n, so);
      u[GROUND_COVER_IMAGE_UNIFORM] = this.coverCanvas;
      const canvas = this.coverCanvas;
      this.afterUpload(() => {
        if (this.coverCanvas === canvas) u['u_coverOn'] = 1;
      });
    } else {
      u['u_coverOn'] = 0;
      u[GROUND_COVER_IMAGE_UNIFORM] = C.Material.DefaultImageId;
    }
    this.scene.requestRender();
  }

  private applyRoadMap(): void {
    const C = this.C;
    if (!this.groundMaterial) return;
    const u = this.groundMaterial.uniforms as Record<string, unknown>;
    if (this.roadBounds && this.roadCanvas) {
      const [w, e, n, so] = this.roadBounds;
      u[GROUND_ROAD_BOUNDS_UNIFORM] = new C.Cartesian4(w, e, n, so);
      u[GROUND_ROAD_IMAGE_UNIFORM] = this.roadCanvas;
      const canvas = this.roadCanvas;
      this.afterUpload(() => {
        if (this.roadCanvas === canvas) u['u_roadOn'] = 1;
      });
    } else {
      u['u_roadOn'] = 0;
      u[GROUND_ROAD_IMAGE_UNIFORM] = C.Material.DefaultImageId;
    }
    this.scene.requestRender();
  }

  /**
   * The streets around a place from the OpenStreetMap vector tiles, drawn to their width into a
   * 3 km square map (~1.5 m texels): roads in R, paths in G, OpenStreetMap's water in B, and
   * alpha 1 wherever a tile answered (so "no water here" is known, not assumed). The ground
   * paints the streets as asphalt and paving in place of the town grid's pattern, and takes
   * the shoreline from the map rather than the terrain's coarse water mask.
   */
  private async loadStreetsAround(p: GeoPoint, template: string): Promise<void> {
    const seq = ++this.roadLoadSeq;
    this.roadTemplate = template;
    this.roadCentre = { lon: p.longitude, lat: p.latitude };
    const HALF_M = 1500;
    const SIZE = 2048;
    const R = 6378137;
    const lat = p.latitude * DEG;
    const lonSpan = HALF_M / (R * Math.cos(lat));
    const merc = Math.log(Math.tan(Math.PI / 4 + lat / 2));
    const mercSpan = HALF_M / (R * Math.cos(lat));
    const west = p.longitude * DEG - lonSpan;
    const east = p.longitude * DEG + lonSpan;
    const north = merc + mercSpan;
    const south = merc - mercSpan;
    const latOf = (m: number) => Math.atan(Math.sinh(m)) / DEG;
    const z = 14;
    const a = lonLatToTile(z, west / DEG, latOf(north));
    const b = lonLatToTile(z, east / DEG, latOf(south));
    const lines: ReturnType<typeof streetLinesFromTile> = [];
    const water: [number, number][][][] = [];
    const known: { x: number; y: number }[] = [];
    const jobs: Promise<void>[] = [];
    for (let x = a.x; x <= b.x; x++)
      for (let y = a.y; y <= b.y; y++)
        jobs.push(
          fetch(tileUrl(template, z, x, y))
            .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
            .then((data) => {
              if (!data) return;
              known.push({ x, y });
              lines.push(...streetLinesFromTile(data, z, x, y));
              for (const shape of coverShapesFromTile(data, z, x, y))
                if (shape.cls === 'water') water.push(shape.rings);
            })
            .catch(() => undefined),
        );
    await Promise.all(jobs);
    if (this.destroyed || seq !== this.roadLoadSeq) return;
    if (known.length === 0) {
      this.roadCanvas = null;
      this.roadBounds = null;
      this.applyRoadMap();
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const mPerPx = (2 * HALF_M) / SIZE;
    const toPx = (lon: number, la: number): [number, number] => {
      const m = Math.log(Math.tan(Math.PI / 4 + (la * DEG) / 2));
      return [((lon * DEG - west) / (east - west)) * SIZE, ((north - m) / (north - south)) * SIZE];
    };
    // Known ground: every tile that answered.
    ctx.fillStyle = 'rgb(0,0,0)';
    for (const t of known) {
      const [x0, y0] = toPx(...tilePointToLonLat(z, t.x, t.y, 1, 0, 0));
      const [x1, y1] = toPx(...tilePointToLonLat(z, t.x, t.y, 1, 1, 1));
      ctx.fillRect(Math.floor(x0), Math.floor(y0), Math.ceil(x1 - x0) + 1, Math.ceil(y1 - y0) + 1);
    }
    // Water.
    ctx.fillStyle = 'rgb(0,0,255)';
    for (const rings of water) {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, la], i) => {
          const [px, py] = toPx(lon, la);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // One path per kind and width, stroked once: a city's thousands of streets stroked one by
    // one held the frame (this runs on the main thread as the walk moves the map).
    const draw = (kind: 'road' | 'path', style: string) => {
      ctx.strokeStyle = style;
      const byWidth = new Map<number, Path2D>();
      for (const l of lines) {
        if (l.kind !== kind) continue;
        const w = Math.max(1, Math.round((l.widthM / mPerPx) * 4) / 4);
        const path = byWidth.get(w) ?? new Path2D();
        byWidth.set(w, path);
        l.points.forEach(([lon, la], i) => {
          const px = ((lon * DEG - west) / (east - west)) * SIZE;
          const m = Math.log(Math.tan(Math.PI / 4 + (la * DEG) / 2));
          const py = ((north - m) / (north - south)) * SIZE;
          if (i === 0) path.moveTo(px, py);
          else path.lineTo(px, py);
        });
      }
      for (const [w, path] of byWidth) {
        ctx.lineWidth = w;
        ctx.stroke(path);
      }
    };
    draw('path', 'rgb(0,255,0)');
    draw('road', 'rgb(255,0,0)');
    this.roadCanvas = canvas;
    this.roadBounds = [west, east, north, south];
    this.applyRoadMap();
  }

  /** Run `fn` after the next render has gone through (an image uniform is uploaded in it), then render again. */
  private afterUpload(fn: () => void): void {
    const remove = this.scene.postRender.addEventListener(() => {
      remove();
      if (this.destroyed) return;
      fn();
      this.scene.requestRender();
    });
    this.scene.requestRender();
  }

  /** Fetch the detail atlas once; the material takes the decoded image, never a URL it might still be loading. */
  private loadDetailAtlas(url: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (this.destroyed) return;
      this.detailAtlas = img;
      this.applyDetailAtlas();
    };
    img.onerror = () => {
      this.onError?.('Ground detail textures unavailable — using the procedural grain', url);
    };
    img.src = url;
  }

  /**
   * The detail tiles' light and shade as one wrapping, mipmapped texture (`detail-tiles.ts`);
   * the material takes it as is (Material accepts a `Texture` directly) and destroys it with
   * itself.
   */
  private applyDetailAtlas(): void {
    const atlas = this.detailAtlas;
    if (!this.groundMaterial || !atlas || this.detailTexture) return;
    const context = (this.scene as unknown as { context?: unknown }).context;
    if (!context) return;
    const texture = createDetailTexture(this.C as unknown as DetailTileCesium, context, atlas);
    if (!texture) return;
    this.detailTexture = texture;
    const u = this.groundMaterial.uniforms as Record<string, unknown>;
    u[GROUND_DETAIL_UNIFORM] = texture;
    u['u_detailOn'] = 1;
  }

  /** The baked noise for a new material (computed once, a few milliseconds; uploaded per material). */
  private applyNoise(): void {
    if (!this.groundMaterial) return;
    const context = (this.scene as unknown as { context?: unknown }).context;
    if (!context) return;
    this.noiseBytes ??= makeNoiseTexture(NOISE_TEXTURE_SIZE);
    const u = this.groundMaterial.uniforms as Record<string, unknown>;
    u[GROUND_NOISE_UNIFORM] = createNoiseTexture(
      this.C as unknown as DetailTileCesium,
      context,
      this.noiseBytes,
      NOISE_TEXTURE_SIZE,
    );
  }

  /**
   * Names on the globe: countries from orbit, then capitals and cities, then towns as the camera
   * closes in (each label's distance from Natural Earth's own zoom, `place-labels.ts`), fading
   * in over the last third of its range. Drawn over the terrain (a sea-level label would sink
   * under a mountain town), so those on the far side of the Earth are hidden by an exact horizon
   * test whenever the camera moves; hidden altogether at a viewpoint, where they would float
   * over the photograph.
   */
  private async loadPlaceLabels(url: string): Promise<void> {
    const C = this.C;
    let set: PlaceLabelSet;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set = parsePlaceLabels(await res.json());
    } catch (error) {
      this.onError?.('Place names unavailable', error);
      return;
    }
    if (this.destroyed) return;
    const labels = new C.LabelCollection();
    const add = (
      text: string,
      lat: number,
      lon: number,
      font: string,
      color: Cesium.Color,
      near: number,
      far: number,
      rank: number,
    ) => {
      const p = C.Cartesian3.fromDegrees(lon, lat, 0);
      this.labelEntries.push({
        text,
        font,
        color,
        near,
        far,
        rank,
        at: { x: p.x, y: p.y, z: p.z },
        label: null,
      });
    };
    const country = C.Color.fromCssColorString('#e8dcc4');
    const capital = C.Color.fromCssColorString('#ffffff');
    const town = C.Color.fromCssColorString('#e6e9ee');
    for (const c of set.countries) {
      const [near, far] = countryDistanceBandM(c);
      add(
        c.name.toUpperCase(),
        c.latitude,
        c.longitude,
        '600 26px system-ui, sans-serif',
        country,
        near,
        far,
        0,
      );
    }
    for (const p of set.places)
      add(
        p.name,
        p.latitude,
        p.longitude,
        p.capital ? '600 30px system-ui, sans-serif' : '500 26px system-ui, sans-serif',
        p.capital ? capital : town,
        0,
        placeMaxDistanceM(p),
        placeRank(p),
      );
    // Held back until the globe's first tiles are in, so the names never float over black.
    labels.show = false;
    this.labels = this.scene.primitives.add(labels) as Cesium.LabelCollection;
    const reveal = () => {
      this.globeReady = true;
      if (this.labels) this.labels.show = this.labelsWanted;
      this.labelCam.x = NaN;
      this.scene.requestRender();
    };
    // "Loaded" is not "drawn": wait for a frame that drew globe tiles with none left to load
    // (or eight seconds, whichever comes first).
    const started = performance.now();
    const remove = this.scene.postRender.addEventListener(() => {
      const surface = (this.scene.globe as unknown as { _surface?: { _tilesToRender?: unknown[] } })
        ._surface;
      const drawn = (surface?._tilesToRender?.length ?? 0) > 0 && this.scene.globe.tilesLoaded;
      if (drawn || performance.now() - started > 8000) {
        remove();
        reveal();
      }
    });
    this.scene.requestRender();
    this.labelCam.x = NaN;
    this.preRenderLabelsRemover = this.scene.preRender.addEventListener(() => this.cullLabels());
    this.scene.requestRender();
  }

  /**
   * Keep in the collection only the names in their distance band and facing the camera (at
   * most PLACE_LABELS_MAX, best ranked first): re-picked when the camera has moved, at most a
   * few times a second while it keeps moving and once more when it stops. A new name is a
   * handful of billboards over glyphs already in the atlas; a name leaving is removed.
   */
  private cullLabels(): void {
    const labels = this.labels;
    if (!labels?.show) return;
    const cam = this.scene.camera.positionWC;
    const last = this.labelCam;
    if (Math.abs(cam.x - last.x) + Math.abs(cam.y - last.y) + Math.abs(cam.z - last.z) < 1) return;
    const now = performance.now();
    if (now - this.labelPickAt < LABEL_PICK_INTERVAL_MS) {
      // Still moving: pick again shortly, so the frame the camera stops on is current.
      this.scene.requestRender();
      return;
    }
    this.labelPickAt = now;
    last.x = cam.x;
    last.y = cam.y;
    last.z = cam.z;
    const C = this.C;
    const keep = new Set(
      visibleLabelIndices(this.labelEntries, { x: cam.x, y: cam.y, z: cam.z }, PLACE_LABELS_MAX),
    );
    // Each new label rasterises its text into the glyph atlas: a whole region's worth at once
    // (arriving over a country) held a frame. A few a frame; the rest on the frames after.
    let added = 0;
    let more = false;
    this.labelEntries.forEach((e, i) => {
      if (keep.has(i)) {
        if (e.label) return;
        if (added >= LABELS_ADDED_PER_FRAME) {
          more = true;
          return;
        }
        added++;
        e.label = labels.add({
          text: e.text,
          position: new C.Cartesian3(e.at.x, e.at.y, e.at.z),
          font: e.font,
          // Rasterised at twice the size and drawn at half: crisp on any display.
          scale: 0.5,
          fillColor: e.color,
          outlineColor: C.Color.BLACK.withAlpha(0.85),
          outlineWidth: 3,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: C.HorizontalOrigin.CENTER,
          verticalOrigin: C.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new C.DistanceDisplayCondition(e.near, e.far),
          translucencyByDistance: new C.NearFarScalar(e.far * 0.66, 1, e.far, 0),
        });
      } else if (e.label) {
        labels.remove(e.label);
        e.label = null;
      }
    });
    if (more) {
      // Not done: pick again next frame, whether or not the camera moves.
      last.x = Number.NaN;
      this.labelPickAt = 0;
      this.scene.requestRender();
    }
  }

  private setLabelsForCamera(kind: HostCamera['kind']): void {
    this.labelsWanted = kind !== 'viewpoint';
    if (this.labels && this.globeReady) {
      this.labels.show = this.labelsWanted;
      this.labelCam.x = NaN;
    }
  }

  /** Whether the basemap under the paint is the bundled coarse one (`u_coarseBasemap`). */
  private setCoarseBasemap(coarse: boolean): void {
    this.coarseBasemap = coarse ? 1 : 0;
    if (this.groundMaterial)
      (this.groundMaterial.uniforms as Record<string, unknown>)['u_coarseBasemap'] =
        this.coarseBasemap;
  }

  async loadLandCoverAround(p: GeoPoint): Promise<LandCoverReading | null> {
    const d = this.landCover;
    const url = d.url;
    if (d.kind === 'none') return this.loadUrbanAround(p);
    if (d.kind !== 'xyz' || !url || this.destroyed) return null;
    const seq = ++this.coverLoadSeq;
    const mosaic = coverMosaicFor(p, d.maxZoom ?? 12);
    const cols = mosaic.x1 - mosaic.x0 + 1;
    const rows = mosaic.y1 - mosaic.y0 + 1;
    const TILE = 256;
    // Tiles are fetched as images with CORS so the canvas stays readable; one that fails leaves
    // its square unknown (transparent), which the shader treats as "no information".
    const loadTile = (x: number, y: number) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = tileUrl(url, mosaic.zoom, x, y);
      });
    const jobs: Array<Promise<{ img: HTMLImageElement | null; x: number; y: number }>> = [];
    for (let y = mosaic.y0; y <= mosaic.y1; y++)
      for (let x = mosaic.x0; x <= mosaic.x1; x++)
        jobs.push(loadTile(x, y).then((img) => ({ img, x, y })));
    const tiles = await Promise.all(jobs);
    if (this.destroyed || seq !== this.coverLoadSeq) return null;
    if (tiles.every((t) => t.img === null)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = cols * TILE;
    canvas.height = rows * TILE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    for (const t of tiles)
      if (t.img)
        ctx.drawImage(t.img, (t.x - mosaic.x0) * TILE, (t.y - mosaic.y0) * TILE, TILE, TILE);
    let pixels: ImageData;
    try {
      pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      // Not reachable with crossOrigin images (a host without CORS fails at load), kept so a
      // tainted canvas can never throw out of here.
      return null;
    }
    const map = coverMapFromPixels(
      pixels.data,
      canvas.width,
      canvas.height,
      d.palette ?? 'worldcover',
    );
    if (map.known <= 0) return null;
    // The packed map goes back into a canvas (the material's image uniform takes one). Its
    // rows run north to south; the upload flips images, so the shader reads the north edge at
    // t = 1. Known texels are opaque, so the canvas's premultiplied alpha costs nothing.
    const out = document.createElement('canvas');
    out.width = map.width;
    out.height = map.height;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.putImageData(new ImageData(map.data, map.width, map.height), 0, 0);
    if (this.destroyed || seq !== this.coverLoadSeq) return null;
    this.coverCanvas = out;
    this.coverBounds = [mosaic.westRad, mosaic.eastRad, mosaic.northMerc, mosaic.southMerc];
    this.applyCoverMap();
    return { known: map.known, shares: map.shares, metresPerPixel: mosaic.metresPerPixel };
  }

  async setBuildings(b: BuildingsDescriptor): Promise<void> {
    const C = this.C;
    // One job at a time: a later call runs after the earlier tileset has settled.
    const run = async () => {
      if (this.destroyed) return;
      if (this.buildings) {
        this.scene.primitives.remove(this.buildings); // destroys it
        this.buildings = null;
      }
      this.osmBuildings?.destroy();
      this.osmBuildings = null;
      if (b.kind === 'none') return;
      if (b.kind === 'vector-tiles') {
        if (!b.url) return;
        this.osmBuildings = new OsmBuildingsLayer(C, this.scene, b.url, (m, e) =>
          this.onError?.(m, e),
        );
        this.osmBuildings.setLean(this.osmLean);
        this.osmBuildings.setSeason(this.leaf.leafOn, this.leaf.autumn, this.leaf.deciduous);
        const sm = this.scene.shadowMap;
        this.osmBuildings.setShadowMap(sm.enabled, sm.darkness, sm.maximumDistance);
        this.osmBuildingsCheckAt = 0;
        this.scene.requestRender();
        return;
      }
      try {
        // Cesium OSM Buildings through ion: lit by the scene light like the terrain, casting and
        // receiving the same shadows, refined to the quality rung. A photographer's "when does
        // the sun reach this street" needs the buildings in the picture, not just the ground.
        // (The ion token is `Ion.defaultAccessToken`, from `setIonToken` once capabilities arrive.)
        const tileset = await C.createOsmBuildingsAsync({
          // Hand-set colours from OSM are kept; the default is a neutral light grey that takes
          // the Sun's colour.
          defaultColor: new C.Color(0.78, 0.76, 0.72, 1),
        });
        if (this.destroyed) {
          tileset.destroy();
          return;
        }
        // Not constructor options of the OSM helper (its typings take colour and style only).
        tileset.shadows = C.ShadowMode.ENABLED;
        tileset.maximumScreenSpaceError = Math.max(8, this.scene.globe.maximumScreenSpaceError * 6);
        this.buildings = tileset;
        this.scene.primitives.add(tileset);
        this.scene.requestRender();
      } catch (error) {
        this.onError?.('Buildings unavailable — showing terrain alone', error);
      }
    };
    const job = (this.buildingsJob ?? Promise.resolve()).then(run);
    this.buildingsJob = job;
    await job;
  }

  terrainHasNormals(): boolean {
    const tp = this.scene.terrainProvider;
    return !(tp instanceof this.C.EllipsoidTerrainProvider) && tp.hasVertexNormals !== false;
  }

  async setTerrain(t: TerrainDescriptor): Promise<void> {
    const C = this.C;
    const job = (async () => {
      try {
        switch (t.kind) {
          case 'ellipsoid':
            this.scene.terrainProvider = new C.EllipsoidTerrainProvider();
            break;
          case 'quantized-mesh':
            if (!t.url) throw new Error('quantized-mesh terrain needs a url');
            // The water mask (where the tile set carries one) lets the globe shade sea and lakes
            // with a specular glint from the scene light — the Sun's reflection on water is part
            // of the picture a photographer plans for (Phase 4 "water"). Providers without a mask
            // simply render as ground.
            this.scene.terrainProvider = await C.CesiumTerrainProvider.fromUrl(t.url, {
              requestVertexNormals: true,
              requestWaterMask: true,
            });
            break;
          case 'cesium-ion':
            this.scene.terrainProvider = await C.CesiumTerrainProvider.fromIonAssetId(
              t.assetId ?? 1,
              {
                requestVertexNormals: true,
                requestWaterMask: true,
                ...(this.ionToken ? { accessToken: this.ionToken } : {}),
              },
            );
            break;
        }
      } catch (error) {
        this.onError?.('Terrain unavailable — showing flat ground', error);
        this.scene.terrainProvider = new C.EllipsoidTerrainProvider();
      }
      // The ground texture is a globe material whose slope and aspect come from the terrain's
      // vertex normals; a tile set without them cannot carry it as intended (Cesium applies a
      // globe material only with normals) — say so, rather than let it pass for a texture bug.
      const tp = this.scene.terrainProvider;
      if (
        t.kind !== 'ellipsoid' &&
        !(tp instanceof C.EllipsoidTerrainProvider) &&
        tp.hasVertexNormals === false
      )
        this.onError?.(
          'This terrain serves no vertex normals — the painted ground reads slope and aspect from them; if the terrain shows the bare basemap, use a terrain set that serves normals (Cesium World Terrain does)',
          null,
        );
    })();
    this.terrainReady = job;
    await job;
    this.scene.requestRender();
  }

  async setBasemap(b: BasemapDescriptor): Promise<void> {
    // A season swap still waiting to drop its old layer: drop it now, before the base changes.
    this.retireLayer?.();
    const C = this.C;
    const layers = this.widget.imageryLayers;
    if (this.baseLayer) {
      layers.remove(this.baseLayer, true);
      this.baseLayer = null;
    }
    // Bundled Natural Earth II is always present underneath as the fallback (plan §34).
    if (!this.fallbackLayer) {
      const ne = await C.TileMapServiceImageryProvider.fromUrl(
        C.buildModuleUrl('Assets/Textures/NaturalEarthII'),
        { credit: 'Natural Earth II (public domain)' },
      );
      this.fallbackLayer = layers.addImageryProvider(ne, 0);
    }
    this.seasonalTiles = false;
    try {
      let provider: Cesium.ImageryProvider | null = null;
      switch (b.kind) {
        case 'cesium-natural-earth':
          provider = null; // fallback layer already shows it
          break;
        case 'xyz':
          if (!b.url) throw new Error('xyz basemap needs a url');
          provider = new C.UrlTemplateImageryProvider({
            url: b.url,
            credit: b.attribution,
            maximumLevel: b.maxZoom ?? 18,
          });
          this.seasonalise(provider);
          break;
        case 'cesium-ion':
          provider = await C.IonImageryProvider.fromAssetId(
            b.assetId ?? 2,
            this.ionToken ? { accessToken: this.ionToken } : {},
          );
          break;
      }
      if (!provider) this.seasonalTiles = false;
      if (provider) {
        this.imagerySeasonKey = seasonKey(this.imagerySeason());
        const layer = layers.addImageryProvider(provider);
        layer.errorEvent.addEventListener((err: unknown) =>
          this.onError?.('Imagery tile failed — Natural Earth II shown underneath', err),
        );
        this.baseLayer = layer;
      }
      this.setCoarseBasemap(!provider);
      this.applyImagerySeason();
    } catch (error) {
      this.setCoarseBasemap(true);
      this.onError?.('Imagery unavailable — showing Natural Earth II', error);
    }
    this.scene.requestRender();
  }

  setCelestialBodies(v: { sun: boolean; moon: boolean; stars: boolean }): void {
    const s = this.scene;
    if (s.sun) s.sun.show = v.sun;
    if (s.moon) s.moon.show = v.moon;
    if (s.skyBox) s.skyBox.show = v.stars;
    // The grade fades the field in through the twilight while it is drawn.
    const starField = s.skyBox && v.stars ? 1 : 0;
    this.gradeUniforms['u_starField'] = starField;
    (this.grade.uniforms as Record<string, unknown>)['u_starField'] = starField;
    s.requestRender();
  }

  setMoonDisc(m: HostMoonDisc | null): void {
    // The Moon glides with the clock like the Sun and the planets; one just risen (or first
    // shown) lands where it is.
    if (m) {
      const d = m.directionEcef;
      this.moonGlide.set({ x: d.x, y: d.y, z: d.z }, this.moonDisc ? this.clockStepId : null);
    }
    this.moonDisc = m;
    const C = this.C;
    this.setGradeValue('u_moonGlow', m?.glow ?? 0);
    this.setGradeValue('u_moonRadiusDeg', m ? m.diameterDeg / 2 : 0);
    if (!m) {
      if (this.moonBillboard?.show) {
        this.moonBillboard.show = false;
        this.scene.requestRender();
      }
      return;
    }
    if (!this.moonBillboards) {
      this.moonBillboards = this.scene.primitives.add(
        new C.BillboardCollection({ scene: this.scene }),
      ) as Cesium.BillboardCollection;
    }
    // The phase is redrawn when it moves a visible step.
    const phase = Math.round(m.illuminatedFraction * 100) / 100;
    if (!this.moonBillboard || phase !== this.moonPhaseDrawn) {
      this.moonPhaseDrawn = phase;
      // One atlas entry per hundredth of phase, reused: a fresh canvas each time took a new
      // entry in Cesium's texture atlas, which never gives one back.
      const id = `lightmap-moon-${Math.round(phase * 100)}`;
      const canvas = document.createElement('canvas');
      canvas.width = MOON_IMAGE_PX;
      canvas.height = MOON_IMAGE_PX;
      const ctx = canvas.getContext('2d');
      if (ctx) drawMoonPhase(ctx, MOON_IMAGE_PX, phase);
      if (!this.moonBillboard)
        this.moonBillboard = this.moonBillboards.add({
          position: new C.Cartesian3(),
          sizeInMeters: true,
          width: 1,
          height: 1,
        });
      this.moonBillboard.setImage(id, canvas);
    }
    this.moonBillboard.show = true;
    // Never quite opaque: an opaque billboard writes depth, and the grade would take the disc
    // for ground (no cloud decks over it, haze instead); translucent it stays sky, and the
    // decks cover it where there is cloud.
    const [tr, tg, tb] = m.tint ?? [1, 1, 1];
    this.moonBillboard.color = new C.Color(tr, tg, tb, Math.max(0, Math.min(0.99, m.opacity)));
    this.placeMoonDisc();
    this.scene.requestRender();
  }

  /**
   * The Moon's billboard this frame: MOON_DISC_RANGE_M from the eye along its direction (beyond
   * any terrain, so a ridge in front hides it as the real Moon is hidden), as wide in metres as
   * its apparent diameter there, and turned so its lit limb faces the Sun on the screen.
   */
  private placeMoonDisc(): void {
    const m = this.moonDisc;
    const b = this.moonBillboard;
    if (!m || !b || !b.show) return;
    const C = this.C;
    const cam = this.scene.camera;
    const d = this.moonGlide.shown ?? m.directionEcef;
    const dir = new C.Cartesian3(d.x, d.y, d.z);
    C.Cartesian3.normalize(dir, dir);
    const at = C.Cartesian3.add(
      cam.positionWC,
      C.Cartesian3.multiplyByScalar(dir, MOON_DISC_RANGE_M, new C.Cartesian3()),
      new C.Cartesian3(),
    );
    b.position = at;
    // The aureole's centre for the grade: the same direction in eye coordinates.
    const dirEC = this.gradeUniforms['u_moonDirEC'] as Cesium.Cartesian3;
    C.Matrix4.multiplyByPointAsVector(cam.viewMatrix, dir, dirEC);
    C.Cartesian3.normalize(dirEC, dirEC);
    (this.grade.uniforms as Record<string, unknown>)['u_moonDirEC'] = dirEC;
    const size = 2 * MOON_DISC_RANGE_M * Math.tan(((m.diameterDeg / 2) * Math.PI) / 180);
    b.width = size;
    b.height = size;
    // The bright limb's direction on screen: from the Moon toward the Sun, across the sky.
    const sun = new C.Cartesian3(m.towardSunEcef.x, m.towardSunEcef.y, m.towardSunEcef.z);
    const across = C.Cartesian3.subtract(
      sun,
      C.Cartesian3.multiplyByScalar(dir, C.Cartesian3.dot(sun, dir), new C.Cartesian3()),
      new C.Cartesian3(),
    );
    if (C.Cartesian3.magnitude(across) < 1e-9) return;
    C.Cartesian3.normalize(across, across);
    const toward = C.Cartesian3.add(
      at,
      C.Cartesian3.multiplyByScalar(across, size, new C.Cartesian3()),
      new C.Cartesian3(),
    );
    const p0 = C.SceneTransforms.worldToWindowCoordinates(this.scene, at);
    const p1 = C.SceneTransforms.worldToWindowCoordinates(this.scene, toward);
    // Window y runs down; a billboard's rotation is counter-clockwise on the screen.
    if (p0 && p1) b.rotation = Math.atan2(-(p1.y - p0.y), p1.x - p0.x);
  }

  /** One of the grade's plain uniforms, written through to the stage and the on-screen record. */
  private setGradeValue(name: string, value: number): void {
    this.gradeUniforms[name] = value;
    (this.grade.uniforms as Record<string, unknown>)[name] = value;
    if (this.gradeShown) this.gradeShown[name] = value;
  }

  setSunGlare(glare: HostSunGlare | null): void {
    if (!glare) {
      this.sunGlareOn = false;
      return;
    }
    this.sunGlareOn = true;
    this.sunGlareLit = glare.lit;
    const tint = this.gradeUniforms['u_sunTint'] as Cesium.Cartesian3;
    [tint.x, tint.y, tint.z] = glare.tint ?? [1, 1, 1];
    (this.grade.uniforms as Record<string, unknown>)['u_sunTint'] = tint;
    const d = glare.towardEcef;
    this.sunGlare.set({ x: d.x, y: d.y, z: d.z }, this.clockStepId);
  }

  setPlanets(planets: ReadonlyArray<HostPlanet | null> | null): void {
    const id = this.clockStepId;
    PLANET_SLOTS.forEach((_, i) => {
      const p = planets?.[i] ?? null;
      const was = this.planetPoints[i];
      this.planetPoints[i] = p;
      if (!p) return;
      const d = p.directionEcef;
      // A planet just come into view lands where it is; one in view glides with the clock.
      this.planetGlides[i]!.set({ x: d.x, y: d.y, z: d.z }, was ? id : null);
    });
    this.scene.requestRender();
  }

  /** The planets' points placed on screen each frame, like the glare (`placeSunGlare`). */
  private placePlanets(): void {
    const g = this.gradeUniforms;
    const target = this.grade.uniforms as Record<string, unknown>;
    PLANET_SLOTS.forEach((name, i) => {
      const u = g[name] as Cesium.Cartesian4;
      const p = this.planetPoints[i];
      const dir = p ? this.planetGlides[i]!.shown : null;
      const pos = p && dir ? this.sunScreenPosition(dir) : null;
      u.x = pos ? pos[0] : -10;
      u.y = pos ? pos[1] : -10;
      u.z = pos && p ? p.peak : 0;
      u.w = p ? p.sigmaPx : 1;
      target[name] = u;
    });
  }

  /**
   * The grade's sun-glare uniforms, placed on screen each frame from the gliding Sun direction
   * and the camera as it is drawn. The grade does not draw a glare of its own today (the glow
   * round the Sun is Cesium's Sun and its sky's Mie scattering); the uniforms are kept true for
   * the shader that reads them, rather than a minute and a camera move behind.
   */
  private placeSunGlare(): void {
    const dir = this.sunGlare.shown;
    if (!this.sunGlareOn || !dir) return;
    const pos = this.sunScreenPosition(dir);
    const g = this.gradeUniforms;
    const screen = g['u_sunScreen'] as Cesium.Cartesian2;
    screen.x = pos ? pos[0] : -1;
    screen.y = pos ? pos[1] : -1;
    const visible = pos && this.sunGlareLit ? 1 : 0;
    g['u_sunVisible'] = visible;
    const target = this.grade.uniforms as Record<string, unknown>;
    target['u_sunScreen'] = screen;
    target['u_sunVisible'] = visible;
    // The same gliding direction in eye coordinates, for the disc's tint.
    const C = this.C;
    const dirEC = g['u_sunDirEC'] as Cesium.Cartesian3;
    this.sunDirScratch ??= new C.Cartesian3();
    C.Matrix4.multiplyByPointAsVector(
      this.scene.camera.viewMatrix,
      C.Cartesian3.fromElements(dir.x, dir.y, dir.z, this.sunDirScratch),
      dirEC,
    );
    C.Cartesian3.normalize(dirEC, dirEC);
    target['u_sunDirEC'] = dirEC;
    if (this.gradeShown) this.gradeShown['u_sunVisible'] = visible;
  }

  sunScreenPosition(toward: Vec3): [number, number] | null {
    const C = this.C;
    const cam = this.scene.camera;
    const far = C.Cartesian3.add(
      cam.positionWC,
      C.Cartesian3.multiplyByScalar(
        new C.Cartesian3(toward.x, toward.y, toward.z),
        1e7,
        new C.Cartesian3(),
      ),
      new C.Cartesian3(),
    );
    const dir = C.Cartesian3.normalize(
      new C.Cartesian3(toward.x, toward.y, toward.z),
      new C.Cartesian3(),
    );
    if (C.Cartesian3.dot(dir, cam.directionWC) <= 0) return null;
    const win = C.SceneTransforms.worldToWindowCoordinates(this.scene, far);
    if (!win) return null;
    const canvas = this.widget.canvas;
    return [win.x / canvas.clientWidth, 1 - win.y / canvas.clientHeight];
  }

  async sampleBasemapPixels(p: GeoPoint): Promise<Array<[number, number, number]> | null> {
    const C = this.C;
    const provider = this.fallbackLayer?.imageryProvider;
    if (!provider || this.destroyed) return null;
    try {
      // Natural Earth II's deepest bundled level (2: a pixel ≈ 20 km) — the regional tone, not
      // the pixel under the pin. A 3 × 3 neighbourhood is returned.
      const level = Math.min(2, provider.maximumLevel ?? 2);
      const carto = C.Cartographic.fromDegrees(p.longitude, p.latitude);
      const xy = provider.tilingScheme.positionToTileXY(carto, level, new C.Cartesian2());
      if (!xy) return null;
      const image = await provider.requestImage(xy.x, xy.y, level);
      if (!image || this.destroyed) return null;
      const rect = provider.tilingScheme.tileXYToRectangle(xy.x, xy.y, level);
      const w = provider.tileWidth;
      const h = provider.tileHeight;
      // Each canvas's own 2D context: through a union of the two canvases, getContext('2d')
      // does not resolve to a 2D context for the type checker.
      let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
      if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(w, h).getContext('2d');
      else {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        ctx = canvas.getContext('2d');
      }
      if (!ctx) return null;
      // Cesium decodes tiles for texture upload, which on browsers with ImageBitmap options
      // means flipped vertically; an HTMLImageElement comes as drawn. Undo the flip so a row
      // means the latitude it says.
      const flipped = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap;
      if (flipped) {
        ctx.translate(0, h);
        ctx.scale(1, -1);
      }
      ctx.drawImage(image, 0, 0, w, h);
      if (flipped) ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
      const fx = (carto.longitude - rect.west) / (rect.east - rect.west);
      const fy = (rect.north - carto.latitude) / (rect.north - rect.south);
      const px = Math.max(1, Math.min(w - 2, Math.floor(fx * w)));
      const py = Math.max(1, Math.min(h - 2, Math.floor(fy * h)));
      const data = ctx.getImageData(px - 1, py - 1, 3, 3).data;
      const out: Array<[number, number, number]> = [];
      for (let i = 0; i < 9; i++)
        out.push([data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0]);
      return out;
    } catch {
      return null;
    }
  }

  async sampleSeaLevel(p: GeoPoint): Promise<number | null> {
    const base = this.geoidUrl;
    if (!base || this.destroyed) return null;
    await this.terrainReady;
    if (this.scene.terrainProvider instanceof this.C.EllipsoidTerrainProvider) return null;
    const key = geoidCellKey(p.latitude, p.longitude);
    let cell = this.geoidCells.get(key);
    if (!cell) {
      cell = fetch(`${base}/${key}.bin`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
      this.geoidCells.set(key, cell);
    }
    const bytes = await cell;
    if (!bytes) {
      this.geoidCells.delete(key); // try again next time
      return null;
    }
    return geoidHeightM(bytes, key, p.latitude, p.longitude);
  }

  async sampleGroundHeight(p: GeoPoint): Promise<number | null> {
    const C = this.C;
    await this.terrainReady;
    try {
      const tp = this.scene.terrainProvider;
      if (tp instanceof C.EllipsoidTerrainProvider) return 0;
      const [res] = await C.sampleTerrainMostDetailed(tp, [
        C.Cartographic.fromDegrees(p.longitude, p.latitude),
      ]);
      return res && Number.isFinite(res.height) ? res.height : null;
    } catch {
      return null;
    }
  }

  async sampleGroundHeights(
    points: readonly GeoPoint[],
    level: number,
  ): Promise<Array<number | null>> {
    const C = this.C;
    await this.terrainReady;
    const tp = this.scene.terrainProvider;
    // No terrain (configured, or the real provider failed to load and the host fell back): the
    // answer is "unknown", never "flat" — a flat profile would claim a terrain effect that was
    // never measured.
    if (tp instanceof C.EllipsoidTerrainProvider) return points.map(() => null);
    const out: Array<number | null> = new Array<number | null>(points.length).fill(null);
    // Chunked so one failed tile does not lose the whole profile.
    const chunk = 1024;
    for (let i = 0; i < points.length; i += chunk) {
      const slice = points.slice(i, i + chunk);
      try {
        const cartos = slice.map((p) => C.Cartographic.fromDegrees(p.longitude, p.latitude));
        // Never ask for a level the provider does not have here (the tile would just be missing).
        let lvl = Math.max(0, Math.min(15, Math.round(level)));
        const first = cartos[0];
        if (tp.availability && first) {
          const max = tp.availability.computeMaximumLevelAtPosition(first);
          if (Number.isFinite(max)) lvl = Math.min(lvl, max);
        }
        const res = await C.sampleTerrain(tp, lvl, cartos);
        res.forEach((c, j) => {
          out[i + j] = c && Number.isFinite(c.height) ? c.height : null;
        });
      } catch {
        // leave nulls
      }
    }
    return out;
  }

  hasBuildingAt(p: GeoPoint): boolean | null {
    if (this.buildings !== null || !this.osmBuildings) return null;
    if (this.osmBuildings.bridgeAt(p.longitude, p.latitude)) return true;
    return this.osmBuildings.hasBuildingAt(p.longitude, p.latitude);
  }

  /**
   * The height of the bridge deck under a point, metres above the ellipsoid, or null when no
   * mapped bridge is there. The deck is not modelled; it is taken as level with the higher of
   * its line's two ends, where it meets the banks (V&V: on Waterloo Bridge the eye stood at the
   * Thames' level, under the embankments).
   */
  private async bridgeDeckAt(p: GeoPoint): Promise<number | null> {
    const bridge = this.osmBuildings?.bridgeAt(p.longitude, p.latitude) ?? null;
    if (!bridge) return null;
    const ends = [bridge.points[0], bridge.points[bridge.points.length - 1]]
      .filter((q): q is [number, number] => q !== undefined)
      .map(([longitude, latitude]) => ({ longitude, latitude }));
    const heights: Array<number | null> = await this.sampleGroundHeights(ends, 15).catch(() => []);
    const known = heights.filter((h): h is number => h !== null);
    return known.length > 0 ? Math.max(...known) : null;
  }

  async sampleSurfaceHeights(points: readonly GeoPoint[]): Promise<Array<number | null> | null> {
    const C = this.C;
    await this.buildingsJob;
    const first = points[0];
    if (this.osmBuildings && first) {
      // The free buildings load around the camera as it moves; a horizon run at a new place
      // waits for the ones around the pin, so its first profile already has them.
      await this.osmBuildings.loadAround(first.longitude, first.latitude).catch(() => undefined);
    }
    const anyBuildings = this.buildings !== null || (this.osmBuildings?.primitiveCount ?? 0) > 0;
    // The trees are a pattern of the mapped woods, not mapped trees: no horizon or roof is
    // read from them.
    const exclude: object[] = this.osmBuildings?.treePrimitives() ?? [];
    if (this.destroyed || !anyBuildings || !this.scene.sampleHeightSupported) return null;
    const out: Array<number | null> = new Array<number | null>(points.length).fill(null);
    // Cesium loads the tiles each query needs at their finest level (the 3D Tiles for every
    // ray; the globe only where its tiles are in view, so a point with no building usually
    // comes back empty and the caller keeps its terrain height). Chunked so one failure leaves
    // the rest, the chunks in flight together — Cesium batches pending picks per frame, so
    // serial chunks would only add a tile-settle wait each.
    const chunk = 128;
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < points.length; i += chunk) {
      const slice = points.slice(i, i + chunk);
      jobs.push(
        (async () => {
          try {
            const cartos = slice.map((p) => C.Cartographic.fromDegrees(p.longitude, p.latitude));
            // A 2 m-wide pick volume, so a thin wall or a roof edge under the probe is hit.
            const res = await this.scene.sampleHeightMostDetailed(cartos, exclude, 2);
            res.forEach((c, j) => {
              // Where the footprints show no building the pick met the globe, whose tiles in
              // view can be coarser than the terrain's finest and stand far above it in steep
              // country (V&V: 186 m near Delicate Arch): the caller keeps its terrain there.
              const p = slice[j];
              const none = p !== undefined && this.hasBuildingAt(p) === false;
              out[i + j] = c && Number.isFinite(c.height) && !none ? c.height : null;
            });
          } catch {
            // leave nulls
          }
        })(),
      );
    }
    const deckJob = first ? this.bridgeDeckAt(first) : Promise.resolve(null);
    await Promise.all(jobs);
    // The pin on a bridge: its deck is the surface there (the eye stands on it, the horizon is
    // read from it).
    const deck = await deckJob;
    if (deck !== null && points.length > 0) out[0] = Math.max(out[0] ?? -Infinity, deck);
    if (this.destroyed) return null;
    return out;
  }

  requestRender(): void {
    this.scene.requestRender();
  }

  stats(): HostStats {
    const globe = this.scene.globe as unknown as {
      _surface?: {
        _tilesToRender?: unknown[];
        _tileLoadQueueHigh?: unknown[];
        _tileLoadQueueMedium?: unknown[];
        _tileLoadQueueLow?: unknown[];
      };
    };
    const surface = globe._surface;
    // Cesium refills the frame's command list at the start of each render, so between frames it
    // holds the last frame's draw commands: the "draw calls" figure the debug panel wants (§27).
    const commands = (this.scene as unknown as { frameState?: { commandList?: unknown[] } })
      .frameState?.commandList;
    const sunWC = (
      this.scene as unknown as {
        context?: { uniformState?: { sunDirectionWC?: Cesium.Cartesian3 } };
      }
    ).context?.uniformState?.sunDirectionWC;
    return {
      fps: this.lastFps,
      terrainTilesLoaded: surface?._tilesToRender?.length ?? 0,
      terrainTilesLoading:
        (surface?._tileLoadQueueHigh?.length ?? 0) +
        (surface?._tileLoadQueueMedium?.length ?? 0) +
        (surface?._tileLoadQueueLow?.length ?? 0),
      drawCalls: Array.isArray(commands) ? commands.length : null,
      cesiumSunDirectionEcef: sunWC ? { x: sunWC.x, y: sunWC.y, z: sunWC.z } : null,
    };
  }

  /**
   * Keeps the OpenStreetMap buildings loaded around the focus: the ground at the centre of the
   * view (where you look in the map), or under the camera when it stands near the ground (the
   * Viewpoint). Checked twice a second at most.
   */
  private updateOsmBuildings(): void {
    const layer = this.osmBuildings;
    if (!layer) return;
    const now = performance.now();
    if (now < this.osmBuildingsCheckAt) return;
    this.osmBuildingsCheckAt = now + 500;
    const C = this.C;
    const scene = this.scene;
    const camCarto = scene.camera.positionCartographic;
    const ground = scene.globe.getHeight(camCarto) ?? 0;
    const above = camCarto.height - ground;
    let lon = camCarto.longitude / DEG;
    let lat = camCarto.latitude / DEG;
    let heightAbove = above;
    if (above > 300) {
      const canvas = scene.canvas;
      const ray = scene.camera.getPickRay(
        new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      );
      const hit = ray ? scene.globe.pick(ray, scene) : undefined;
      if (hit) {
        const c = C.Cartographic.fromCartesian(hit);
        lon = c.longitude / DEG;
        lat = c.latitude / DEG;
        heightAbove = C.Cartesian3.distance(scene.camera.positionWC, hit);
      }
    }
    layer.update(lon, lat, heightAbove);
    // The street map follows you: redrawn around the focus once it is 700 m from its centre.
    if (this.roadTemplate && this.roadCentre && heightAbove < 3000) {
      const dx = (lon - this.roadCentre.lon) * 111_320 * Math.cos(lat * DEG);
      const dy = (lat - this.roadCentre.lat) * 111_320;
      if (Math.hypot(dx, dy) > 700)
        void this.loadStreetsAround({ latitude: lat, longitude: lon }, this.roadTemplate);
    }
    // Standing on the ground (the Viewpoint): no generic tree where the eye is.
    if (above < 60) layer.hideTreesNear(scene.camera.positionWC);
  }

  /**
   * The ground under a point of the canvas (CSS pixels from its top left): a building's footprint
   * is put on the terrain, the sky gives null. The Viewpoint uses it to walk to where you click.
   */
  pickAt(x: number, y: number): (GeoPoint & { viaTerrain: boolean }) | null {
    if (this.destroyed) return null;
    return this.pickWindow({ x, y });
  }

  private pickWindow(position: {
    x: number;
    y: number;
  }): (GeoPoint & { viaTerrain: boolean }) | null {
    const C = this.C;
    const scene = this.scene;
    const hit = pickSurface(
      {
        // The globe's own ray pick needs no depth texture; the buildings' does.
        pickPositionSupported: true,
        pickPosition: (w) => {
          const win = new C.Cartesian2(w.x, w.y);
          // The ground under the cursor, not a roof and not the terrain behind a façade:
          // with buildings on, the depth pick lands on the tileset where a building is
          // under the cursor — keep that spot and put it on the terrain (the pin's height
          // feeds the geoid and snow rules; the horizon treats a pin on a footprint as a
          // roof). Without a building under the cursor the globe's ray pick is the ground.
          if ((this.buildings || this.osmBuildings) && scene.pickPositionSupported) {
            const picked: unknown = scene.pick(win);
            const onBuilding =
              picked instanceof C.Cesium3DTileFeature ||
              (typeof picked === 'object' &&
                picked !== null &&
                ((picked as { primitive?: unknown }).primitive === this.buildings ||
                  this.osmBuildings?.owns((picked as { primitive?: unknown }).primitive) === true));
            if (onBuilding) {
              const p = scene.pickPosition(win);
              if (p) {
                const carto = C.Cartographic.fromCartesian(p);
                // The terrain's height there, once its tile is loaded; otherwise the
                // façade point's own height is no ground, so the ray pick below decides.
                const h = scene.globe.getHeight(carto);
                if (h !== undefined)
                  return C.Cartesian3.fromRadians(carto.longitude, carto.latitude, h);
              }
            }
          }
          const ray = scene.camera.getPickRay(win);
          const onTerrain = ray ? scene.globe.pick(ray, scene) : undefined;
          if (onTerrain) return onTerrain;
          if (!scene.pickPositionSupported) return undefined;
          const r = scene.pickPosition(win);
          return r ?? undefined;
        },
        pickEllipsoid: (w) => scene.camera.pickEllipsoid(new C.Cartesian2(w.x, w.y)),
        toCartographic: (c) => C.Cartographic.fromCartesian(new C.Cartesian3(c.x, c.y, c.z)),
      },
      position,
    );
    return hit ?? null;
  }

  onPick(handler: (p: GeoPoint & { viaTerrain: boolean }) => void): () => void {
    const C = this.C;
    this.pickListeners.add(handler);
    if (!this.pickHandler) {
      this.pickHandler = new C.ScreenSpaceEventHandler(this.widget.canvas);
      this.pickHandler.setInputAction(
        (movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
          const hit = this.pickWindow(movement.position);
          if (hit) for (const l of this.pickListeners) l(hit);
        },
        C.ScreenSpaceEventType.LEFT_CLICK,
      );
    }
    return () => {
      this.pickListeners.delete(handler);
    };
  }

  onFrameSample(handler: (fps: number) => void): () => void {
    this.frameListeners.add(handler);
    return () => {
      this.frameListeners.delete(handler);
    };
  }

  resize(): void {
    this.widget.resize();
    this.scene.requestRender();
  }

  async captureThumbnail(maxWidth: number): Promise<string | null> {
    try {
      // Render-on-demand skips a frame nobody asked for, and without a preserved drawing buffer
      // an idle canvas reads back empty: ask for one, at the planned time (not the wall clock).
      this.scene.requestRender();
      this.scene.render(this.widget.clock.currentTime);
      const src = this.widget.canvas;
      const scale = Math.min(1, maxWidth / src.width);
      const out = document.createElement('canvas');
      out.width = Math.round(src.width * scale);
      out.height = Math.round(src.height * scale);
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(src, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.8);
    } catch {
      return null;
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (this.seasonSwapTimer) clearTimeout(this.seasonSwapTimer);
    this.retireLayer?.();
    if (this.destroyed) return;
    this.destroyed = true;
    this.preRenderRemover?.();
    this.preRenderGroundRemover?.();
    this.buildings = null;
    this.osmBuildings?.destroy();
    this.osmBuildings = null;
    this.pickHandler?.destroy();
    this.groundMaterial?.destroy();
    this.groundMaterial = null;
    this.detailTexture = null;
    this.preRenderLabelsRemover?.();
    this.preRenderLabelsRemover = null;
    this.labels = null; // owned by scene.primitives, destroyed with the widget
    this.labelEntries = [];
    this.widget.destroy();
  }
}

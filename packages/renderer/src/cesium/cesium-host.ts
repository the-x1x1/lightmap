/**
 * CesiumSceneHost — the ONE file typed against `@cesium/engine` (ADR-0002).
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
import { createDetailTextures, type DetailTileCesium } from './detail-tiles.ts';
import { clearOrbitPitch, orbitSightLine, steeperPitches } from '../camera-math.ts';
import {
  aboveHorizon,
  countryDistanceBandM,
  parsePlaceLabels,
  placeMaxDistanceM,
  type PlaceLabelSet,
} from '../place-labels.ts';
import {
  GROUND_COVER_BOUNDS_UNIFORM,
  GROUND_COVER_IMAGE_UNIFORM,
  GROUND_DETAIL_IMAGE_UNIFORMS,
  GROUND_DETAIL_TIERS,
  GROUND_MOTTLE_SCALES,
  GROUND_GRAIN_M,
  GROUND_MATERIAL_SOURCE,
  GROUND_MATERIAL_TYPE,
  GROUND_UNIFORM_DEFAULTS,
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
import type { Vec3 } from '../sun-vector.ts';
import type {
  HostAtmosphere,
  HostCamera,
  HostGlobeShading,
  HostGradeUniforms,
  HostGroundTexture,
  HostLight,
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
/** Frames in a one-second window below which the scene is judged idle, not slow. */
export const MIN_FRAMES_FOR_SAMPLE = 12;

const HIDDEN_RUN_POOL = 6;
/**
 * Without a pin to anchor to, the detail tiles' ground frame is re-anchored when the point under
 * the camera has moved this far, metres. A re-anchor shifts the whole pattern, so it must be
 * rare: with a pin the frame stays at the pin (zooming in and out never moves it).
 */
const DETAIL_REANCHOR_M = 200_000;

export class CesiumSceneHost implements SceneHost {
  private readonly C: CesiumModule;
  private readonly widget: Cesium.CesiumWidget;
  private readonly scene: Cesium.Scene;
  private readonly light: Cesium.DirectionalLight;
  private readonly grade: Cesium.PostProcessStage;
  private readonly gradeUniforms: Record<string, unknown>;
  private groundMaterial: Cesium.Material | null = null;
  private buildings: Cesium.Cesium3DTileset | null = null;
  private buildingsJob: Promise<void> | null = null;
  private groundTextureFailed = false;
  private landCover: LandCoverDescriptor = { kind: 'none', attribution: '' };
  /** The cover map's bounds once loaded (`u_coverBounds`), applied when the material exists. */
  private coverBounds: [number, number, number, number] | null = null;
  private coverCanvas: HTMLCanvasElement | null = null;
  private coverLoadSeq = 0;
  private readonly detailAtlasUrl: string | undefined;
  private readonly urbanAreasUrl: string | undefined;
  private urbanIndex: Promise<Set<string> | null> | null = null;
  private readonly urbanCells = new Map<string, Promise<UrbanPolygon[]>>();
  private readonly enuScratch: {
    east: Cesium.Cartesian3;
    north: Cesium.Cartesian3;
    up: Cesium.Cartesian3;
    anchor: Cesium.Cartesian3;
    anchored: boolean;
  };
  /** The detail atlas once its image has loaded; the material takes it then, never a URL. */
  private detailAtlas: HTMLImageElement | null = null;
  /** The four wrapping tile textures cut from the atlas, owned here and destroyed with the host. */
  private detailTextures: Record<string, { destroy(): void }> | null = null;
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
  private labelEntries: Array<{ label: Cesium.Label; at: Vec3 }> = [];
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
  private frameCount = 0;
  private frameWindowStart = 0;
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

  constructor(C: CesiumModule, options: CesiumHostOptions) {
    this.C = C;
    this.onError = options.onError;
    this.ionToken = options.ionToken;
    this.detailAtlasUrl = options.groundDetailAtlasUrl;
    this.urbanAreasUrl = options.urbanAreasUrl?.replace(/\/$/, '');
    this.eyeUpScratch = new C.Cartesian3();
    this.enuScratch = {
      east: new C.Cartesian3(),
      north: new C.Cartesian3(),
      up: new C.Cartesian3(),
      anchor: new C.Cartesian3(),
      anchored: false,
    };
    if (options.ionToken) C.Ion.defaultAccessToken = options.ionToken;

    this.widget = new C.CesiumWidget(options.container, {
      baseLayer: false,
      creditContainer: options.creditContainer,
      msaaSamples: options.msaaSamples ?? 4,
      requestRenderMode: options.requestRenderMode ?? true,
      maximumRenderTimeChange: Number.POSITIVE_INFINITY,
      shadows: true,
      terrainShadows: C.ShadowMode.ENABLED,
      contextOptions: {
        webgl: { preserveDrawingBuffer: true, powerPreference: 'high-performance' },
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
    // A larger tile cache and the ancestors kept loaded: zooming out and back in redraws from
    // tiles already in hand instead of dropping to coarse ones and re-fetching (the "pop").
    globe.tileCacheSize = 1000;
    globe.preloadSiblings = true;
    globe.preloadAncestors = true;
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

    // Frame-rate sampling for the quality governor. With requestRenderMode the scene draws only on
    // demand, so frames-per-wall-clock is meaningless while idle; a sample is emitted only for a
    // one-second window with at least MIN_FRAMES_FOR_SAMPLE frames (continuous interaction: a
    // scrub, an orbit, a flight). Idle windows are discarded.
    this.frameWindowStart = performance.now();
    // The ground texture's near grain is anchored to the ground through the camera's position,
    // split into a whole number of cells and a fraction in double precision each frame.
    // The detail atlas is fetched once, up front; the material takes it when both exist.
    if (this.detailAtlasUrl) this.loadDetailAtlas(this.detailAtlasUrl);
    if (options.placeLabelsUrl) void this.loadPlaceLabels(options.placeLabelsUrl);
    this.preRenderGroundRemover = scene.preRender.addEventListener(() => {
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
      const cell = u['u_cameraCell'] as Cesium.Cartesian3;
      const frac = u['u_cameraFrac'] as Cesium.Cartesian3;
      const cx = Math.floor(cam.x / GROUND_GRAIN_M);
      const cy = Math.floor(cam.y / GROUND_GRAIN_M);
      const cz = Math.floor(cam.z / GROUND_GRAIN_M);
      cell.x = cx;
      cell.y = cy;
      cell.z = cz;
      frac.x = cam.x / GROUND_GRAIN_M - cx;
      frac.y = cam.y / GROUND_GRAIN_M - cy;
      frac.z = cam.z / GROUND_GRAIN_M - cz;
      // The detail atlas is projected along an east/north/up frame anchored to the ground: the
      // frame is taken at an anchor point and kept until the camera has moved kilometres from
      // it (well beyond the 500 m the atlas reaches, so a re-anchor is never seen), and each
      // frame only the camera's own position along those fixed axes, in tile periods — the
      // fraction, in double — goes to the shader. A frame that followed the camera would drag
      // the pattern with it.
      if (this.detailAtlasUrl) {
        const anchor = this.enuScratch.anchor;
        const { east, north, up } = this.enuScratch;
        // Anchor at the pin when there is one (the orbit's target, the viewpoint's eye), so
        // the frame never moves while zooming; otherwise at the point under the camera, kept
        // until that has travelled far.
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
        if (want) {
          const n = C.Ellipsoid.WGS84.geodeticSurfaceNormal(want, up);
          const h = Math.hypot(want.x, want.y);
          if (n && h >= 1) {
            east.x = -want.y / h;
            east.y = want.x / h;
            east.z = 0;
            C.Cartesian3.cross(up, east, north);
            C.Cartesian3.clone(want, anchor);
            this.enuScratch.anchored = true;
            C.Cartesian3.clone(east, u['u_eastWC'] as Cesium.Cartesian3);
            C.Cartesian3.clone(north, u['u_northWC'] as Cesium.Cartesian3);
            C.Cartesian3.clone(up, u['u_upWC'] as Cesium.Cartesian3);
          }
        }
        if (this.enuScratch.anchored) {
          const f = (v: number) => v - Math.floor(v);
          const ce = C.Cartesian3.dot(cam, east);
          const cn = C.Cartesian3.dot(cam, north);
          const cu = C.Cartesian3.dot(cam, up);
          for (const tier of GROUND_DETAIL_TIERS) {
            const off = u[tier.offsetUniform] as Cesium.Cartesian3;
            off.x = f(ce / tier.periodM);
            off.y = f(cn / tier.periodM);
            off.z = f(cu / tier.periodM);
          }
          for (const m of GROUND_MOTTLE_SCALES) {
            const cellU = u[m.cellUniform] as Cesium.Cartesian3;
            const fracU = u[m.fracUniform] as Cesium.Cartesian3;
            const x = ce / m.cellM;
            const y = cn / m.cellM;
            const z = cu / m.cellM;
            cellU.x = Math.floor(x);
            cellU.y = Math.floor(y);
            cellU.z = Math.floor(z);
            fracU.x = x - cellU.x;
            fracU.y = y - cellU.y;
            fracU.z = z - cellU.z;
          }
        }
      }
    });
    this.preRenderRemover = scene.postRender.addEventListener(() => {
      this.frameCount++;
      const now = performance.now();
      if (now - this.frameWindowStart >= 1000) {
        const fps = (this.frameCount * 1000) / (now - this.frameWindowStart);
        const continuous = this.frameCount >= MIN_FRAMES_FOR_SAMPLE;
        this.frameCount = 0;
        this.frameWindowStart = now;
        if (continuous) {
          this.lastFps = fps;
          for (const l of this.frameListeners) l(fps);
        }
      }
    });

    scene.renderError.addEventListener((_s: unknown, error: unknown) => {
      // The widget stops its render loop on an error. A globe material that fails to compile
      // on this GPU is the one failure the host can recover from: drop the texture, resume.
      if (this.groundMaterial) {
        globe.material = undefined;
        // The material destroys the textures it holds, the detail tiles among them.
        this.groundMaterial.destroy();
        this.detailTextures = null;
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
    this.widget.clock.currentTime = this.C.JulianDate.fromDate(utc);
  }

  setLight(light: HostLight): void {
    const C = this.C;
    const d = light.directionEcef;
    C.Cartesian3.normalize(new C.Cartesian3(d.x, d.y, d.z), this.light.direction);
    this.light.color = new C.Color(light.color[0], light.color[1], light.color[2], 1);
    this.light.intensity = light.intensity;
  }

  setGlobeShading(shading: HostGlobeShading): void {
    const globe = this.scene.globe as Cesium.Globe | undefined;
    if (!globe) return;
    globe.enableLighting = shading.lit;
    // Every imagery layer dims together, so a provider basemap and the Natural Earth fallback
    // underneath it read as one chart.
    const layers = this.widget.imageryLayers;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers.get(i);
      layer.brightness = shading.basemapBrightness;
    }
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
        this.detailTextures = null;
        this.groundMaterial = null;
      }
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
          uniforms: {
            ...GROUND_UNIFORM_DEFAULTS,
            [GROUND_COVER_BOUNDS_UNIFORM]: new C.Cartesian4(0, 0, 0, 0),
            [GROUND_COVER_IMAGE_UNIFORM]: C.Material.DefaultImageId,
            ...Object.fromEntries(
              Object.values(GROUND_DETAIL_IMAGE_UNIFORMS).map((name) => [
                name,
                C.Material.DefaultImageId,
              ]),
            ),
            u_detailOn: 0,
            u_coarseBasemap: this.coarseBasemap,
            u_eastWC: new C.Cartesian3(1, 0, 0),
            u_northWC: new C.Cartesian3(0, 1, 0),
            u_upWC: new C.Cartesian3(0, 0, 1),
            ...Object.fromEntries(
              GROUND_DETAIL_TIERS.map((t) => [t.offsetUniform, new C.Cartesian3(0, 0, 0)]),
            ),
            ...Object.fromEntries(
              GROUND_MOTTLE_SCALES.flatMap((m) => [
                [m.cellUniform, new C.Cartesian3(0, 0, 0)],
                [m.fracUniform, new C.Cartesian3(0, 0, 0)],
              ]),
            ),
            u_cameraCell: new C.Cartesian3(0, 0, 0),
            u_cameraFrac: new C.Cartesian3(0, 0, 0),
          },
          source: GROUND_MATERIAL_SOURCE,
        },
        translucent: false,
        // The atlas is a 1 cm-per-texel image read out to 500 m: it needs a mip chain (the
        // cover map, a 768 px canvas, gets one too — fine on the WebGL2 the app requires).
        minificationFilter: C.TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
        magnificationFilter: C.TextureMagnificationFilter.LINEAR,
      });
      globe.material = this.groundMaterial;
      this.applyCoverMap();
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
    this.scene.requestRender();
  }

  setShadows(s: HostShadows): void {
    const sm = this.scene.shadowMap;
    sm.enabled = s.enabled;
    sm.darkness = s.darkness;
    if (sm.size !== s.size) sm.size = s.size;
    if (sm.softShadows !== s.softShadows) sm.softShadows = s.softShadows;
    if (Math.abs(sm.maximumDistance - s.maximumDistance) > 1)
      sm.maximumDistance = s.maximumDistance;
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
    for (const key of Object.keys(g)) if (typeof g[key] !== 'function') target[key] = g[key];
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
    if (c.kind === 'viewpoint') {
      ssc.enableInputs = false; // React layer handles drag-to-look via CameraState
      // A flight still under way (to the place's orbit view) would carry on over this view.
      cam.cancelFlight();
      cam.lookAtTransform(C.Matrix4.IDENTITY);
      const frustum = cam.frustum;
      if (frustum instanceof C.PerspectiveFrustum) frustum.fov = c.fovDeg * DEG;
      cam.setView({
        destination: C.Cartesian3.fromDegrees(c.eye.longitude, c.eye.latitude, c.heightM),
        orientation: { heading: c.headingDeg * DEG, pitch: c.pitchDeg * DEG, roll: 0 },
      });
    } else {
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
    pinE.position = new C.ConstantPositionProperty(base);
    pinE.show = true;
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
    if (o.sun) {
      const sunPos = local(o.sun.azimuthDeg, o.sun.elevationDeg, o.radiusM);
      sunE.position = new C.ConstantPositionProperty(sunPos);
      sunE.show = true;
      rayE.polyline!.positions = new C.ConstantProperty([base, sunPos]);
      rayE.show = true;
    } else {
      sunE.show = false;
      rayE.show = false;
    }
    if (o.shadowAzimuthDeg !== null) {
      shadowE.polyline!.positions = new C.ConstantProperty([
        base,
        local(o.shadowAzimuthDeg, 0.5, Math.min(o.radiusM * 0.5, 200)),
      ]);
      shadowE.show = true;
    } else shadowE.show = false;
  }

  setQuality(q: HostQuality): void {
    this.scene.globe.maximumScreenSpaceError = q.terrainScreenSpaceError;
    // Buildings follow the same rung: their tiles are refined to the same screen-space error.
    if (this.buildings)
      this.buildings.maximumScreenSpaceError = Math.max(8, q.terrainScreenSpaceError * 6);
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    this.widget.resolutionScale = Math.min(q.resolutionScale, 2 / dpr);
  }

  setIonToken(token: string | undefined): void {
    this.ionToken = token;
    if (token) this.C.Ion.defaultAccessToken = token;
  }

  /**
   * With no land-cover source: the bundled urban areas around the pin, filled into a cover map
   * as built-up ground (everything else stays unknown, so the procedural rules hold there).
   */
  private async loadUrbanAround(p: GeoPoint): Promise<LandCoverReading | null> {
    const base = this.urbanAreasUrl;
    if (!base || this.destroyed) return null;
    const seq = ++this.coverLoadSeq;
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
    if (!index) {
      this.urbanIndex = null; // try again next time
      return null;
    }
    const mosaic = coverMosaicFor(p, 12);
    const keys = urbanCellsFor(mosaicBox(mosaic)).filter((k) => index.has(k));
    const polys: UrbanPolygon[] = [];
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
    if (this.destroyed || seq !== this.coverLoadSeq) return null;
    const TILE = 256;
    const width = (mosaic.x1 - mosaic.x0 + 1) * TILE;
    const height = (mosaic.y1 - mosaic.y0 + 1) * TILE;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const [r, g, b] = packCover('built');
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    for (const poly of polys) {
      ctx.beginPath();
      for (const ring of poly) {
        ring.forEach(([lon, lat], i) => {
          const [x, y] = mosaicPixel(mosaic, width, height, lon, lat);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
    // The share of the map that is built up, for the reading (alpha marks known texels).
    const data = ctx.getImageData(0, 0, width, height).data;
    let built = 0;
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) >= 128) built++;
    const share = built / (width * height);
    if (this.destroyed || seq !== this.coverLoadSeq) return null;
    this.coverCanvas = share > 0 ? canvas : null;
    this.coverBounds =
      share > 0 ? [mosaic.westRad, mosaic.eastRad, mosaic.northMerc, mosaic.southMerc] : null;
    this.applyCoverMap();
    const rounded = Math.round(share * 1000) / 1000;
    return {
      known: rounded,
      shares: rounded > 0 ? { built: rounded } : {},
      metresPerPixel: mosaic.metresPerPixel,
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
   * Cut the atlas into its four tiles and hand the material one wrapping, mipmapped texture
   * per surface. A material's own image uniforms clamp at their edges and share one mip chain,
   * so an atlas bled across its quadrants at every level but the first; a `Texture` the host
   * builds itself takes a REPEAT sampler and is used as is (Material accepts one directly).
   */
  private applyDetailAtlas(): void {
    const atlas = this.detailAtlas;
    if (!this.groundMaterial || !atlas) return;
    const u = this.groundMaterial.uniforms as Record<string, unknown>;
    if (!this.detailTextures) {
      const context = (this.scene as unknown as { context?: unknown }).context;
      if (!context) return;
      const textures = createDetailTextures(this.C as unknown as DetailTileCesium, context, atlas);
      if (!textures) return;
      this.detailTextures = textures;
    }
    const first = GROUND_DETAIL_IMAGE_UNIFORMS.grass;
    if (u[first] === this.detailTextures[first]) return;
    for (const [name, texture] of Object.entries(this.detailTextures)) u[name] = texture;
    u['u_detailOn'] = 1;
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
    ) => {
      const position = C.Cartesian3.fromDegrees(lon, lat, 0);
      const label = labels.add({
        text,
        position,
        font,
        // Rasterised at twice the size and drawn at half: crisp on any display.
        scale: 0.5,
        fillColor: color,
        outlineColor: C.Color.BLACK.withAlpha(0.85),
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: C.HorizontalOrigin.CENTER,
        verticalOrigin: C.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new C.DistanceDisplayCondition(near, far),
        translucencyByDistance: new C.NearFarScalar(far * 0.66, 1, far, 0),
      });
      this.labelEntries.push({ label, at: { x: position.x, y: position.y, z: position.z } });
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

  /** Hide the labels on the far side of the Earth; only when the camera has moved. */
  private cullLabels(): void {
    if (!this.labels?.show) return;
    const cam = this.scene.camera.positionWC;
    const last = this.labelCam;
    if (Math.abs(cam.x - last.x) + Math.abs(cam.y - last.y) + Math.abs(cam.z - last.z) < 1) return;
    last.x = cam.x;
    last.y = cam.y;
    last.z = cam.z;
    const c = { x: cam.x, y: cam.y, z: cam.z };
    for (const e of this.labelEntries) {
      const show = aboveHorizon(e.at, c);
      if (e.label.show !== show) e.label.show = show;
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
      if (b.kind === 'none') return;
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
          break;
        case 'cesium-ion':
          provider = await C.IonImageryProvider.fromAssetId(
            b.assetId ?? 2,
            this.ionToken ? { accessToken: this.ionToken } : {},
          );
          break;
      }
      if (provider) {
        const layer = layers.addImageryProvider(provider);
        layer.errorEvent.addEventListener((err: unknown) =>
          this.onError?.('Imagery tile failed — Natural Earth II shown underneath', err),
        );
        this.baseLayer = layer;
      }
      this.setCoarseBasemap(!provider);
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
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = canvas.getContext('2d');
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

  async sampleSurfaceHeights(points: readonly GeoPoint[]): Promise<Array<number | null> | null> {
    const C = this.C;
    await this.buildingsJob;
    if (this.destroyed || !this.buildings || !this.scene.sampleHeightSupported) return null;
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
            const res = await this.scene.sampleHeightMostDetailed(cartos, [], 2);
            res.forEach((c, j) => {
              out[i + j] = c && Number.isFinite(c.height) ? c.height : null;
            });
          } catch {
            // leave nulls
          }
        })(),
      );
    }
    await Promise.all(jobs);
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

  onPick(handler: (p: GeoPoint & { viaTerrain: boolean }) => void): () => void {
    const C = this.C;
    this.pickListeners.add(handler);
    if (!this.pickHandler) {
      this.pickHandler = new C.ScreenSpaceEventHandler(this.widget.canvas);
      this.pickHandler.setInputAction(
        (movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
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
                if (this.buildings && scene.pickPositionSupported) {
                  const picked: unknown = scene.pick(win);
                  const onBuilding =
                    picked instanceof C.Cesium3DTileFeature ||
                    (typeof picked === 'object' &&
                      picked !== null &&
                      (picked as { primitive?: unknown }).primitive === this.buildings);
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
            movement.position,
          );
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
      this.scene.render();
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
    if (this.destroyed) return;
    this.destroyed = true;
    this.preRenderRemover?.();
    this.preRenderGroundRemover?.();
    this.buildings = null;
    this.pickHandler?.destroy();
    this.groundMaterial?.destroy();
    this.groundMaterial = null;
    this.detailTextures = null;
    this.preRenderLabelsRemover?.();
    this.preRenderLabelsRemover = null;
    this.labels = null; // owned by scene.primitives, destroyed with the widget
    this.labelEntries = [];
    this.widget.destroy();
  }
}

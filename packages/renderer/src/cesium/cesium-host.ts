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
import type { BasemapDescriptor, GeoPoint, TerrainDescriptor } from '@lightmap/geospatial';
import { GRADE_FRAGMENT_SHADER } from '../shaders/grade.frag.ts';
import { pickSurface } from '../pick.ts';
import type { Vec3 } from '../sun-vector.ts';
import type {
  HostAtmosphere,
  HostCamera,
  HostGradeUniforms,
  HostLight,
  HostOverlay,
  HostQuality,
  HostShadows,
  HostStats,
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

export class CesiumSceneHost implements SceneHost {
  private readonly C: CesiumModule;
  private readonly widget: Cesium.CesiumWidget;
  private readonly scene: Cesium.Scene;
  private readonly light: Cesium.DirectionalLight;
  private readonly grade: Cesium.PostProcessStage;
  private readonly gradeUniforms: Record<string, unknown>;
  private readonly onError: ((message: string, error: unknown) => void) | undefined;
  private readonly ionToken: string | undefined;
  private pickHandler: Cesium.ScreenSpaceEventHandler | null = null;
  private pickListeners = new Set<(p: GeoPoint & { viaTerrain: boolean }) => void>();
  private frameListeners = new Set<(fps: number) => void>();
  private frameCount = 0;
  private frameWindowStart = 0;
  private lastFps = 0;
  private overlayEntities: Cesium.Entity[] = [];
  private baseLayer: Cesium.ImageryLayer | null = null;
  private fallbackLayer: Cesium.ImageryLayer | null = null;
  private terrainReady: Promise<void> = Promise.resolve();
  private lastCameraKey = '';
  private preRenderRemover: (() => void) | null = null;

  constructor(C: CesiumModule, options: CesiumHostOptions) {
    this.C = C;
    this.onError = options.onError;
    this.ionToken = options.ionToken;
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
    });
    this.scene = this.widget.scene;
    this.widget.useBrowserRecommendedResolution = false;

    const scene = this.scene;
    const globe = scene.globe;
    globe.enableLighting = true;
    globe.dynamicAtmosphereLighting = true;
    globe.dynamicAtmosphereLightingFromSun = false; // follow scene.light, not Cesium's sun
    globe.showGroundAtmosphere = true;
    globe.depthTestAgainstTerrain = true;
    globe.shadows = C.ShadowMode.ENABLED;
    globe.tileCacheSize = 300;
    globe.preloadSiblings = true;
    globe.baseColor = new C.Color(0.16, 0.18, 0.2, 1);
    scene.backgroundColor = new C.Color(0.02, 0.03, 0.05, 1);
    scene.atmosphere.dynamicLighting = C.DynamicAtmosphereLightingType.SCENE_LIGHT;
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
    sm.fadingEnabled = true;
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
      u_skyLuminance: 1,
      u_nightFactor: 0,
      u_precipitation: 0,
      u_time: 0,
      u_sunScreen: new C.Cartesian2(-1, -1),
      u_sunVisible: 0,
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

  setShadows(s: HostShadows): void {
    const sm = this.scene.shadowMap;
    sm.enabled = s.enabled;
    sm.darkness = s.darkness;
    if (sm.size !== s.size) sm.size = s.size;
    if (sm.softShadows !== s.softShadows) sm.softShadows = s.softShadows;
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
    scene.globe.atmosphereHueShift = a.hueShift;
    scene.globe.atmosphereSaturationShift = a.saturationShift;
    scene.globe.atmosphereBrightnessShift = a.brightnessShift;
    scene.atmosphere.hueShift = a.hueShift;
    scene.atmosphere.saturationShift = a.saturationShift;
    scene.atmosphere.brightnessShift = a.brightnessShift;
    scene.fog.density = a.fogDensity;
  }

  setGrade(u: HostGradeUniforms): void {
    const g = this.gradeUniforms;
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
    g['u_skyLuminance'] = u.u_skyLuminance;
    g['u_nightFactor'] = u.u_nightFactor;
    g['u_precipitation'] = u.u_precipitation;
    g['u_time'] = u.u_time;
    (g['u_sunScreen'] as Cesium.Cartesian2).x = u.u_sunScreen[0];
    (g['u_sunScreen'] as Cesium.Cartesian2).y = u.u_sunScreen[1];
    g['u_sunVisible'] = u.u_sunVisible;
    // PostProcessStage copies uniform values on assignment; write them through.
    const target = this.grade.uniforms as Record<string, unknown>;
    for (const key of Object.keys(g)) target[key] = g[key];
  }

  setCamera(c: HostCamera): void {
    const C = this.C;
    const cam = this.scene.camera;
    const ssc = this.scene.screenSpaceCameraController;
    const key = JSON.stringify(c);
    if (key === this.lastCameraKey) return;
    this.lastCameraKey = key;
    if (c.kind === 'viewpoint') {
      ssc.enableInputs = false; // React layer handles drag-to-look via CameraState
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
      const target = C.Cartesian3.fromDegrees(
        c.target.longitude,
        c.target.latitude,
        c.targetHeightM,
      );
      const offset = new C.HeadingPitchRange(c.headingDeg * DEG, c.pitchDeg * DEG, c.rangeM);
      if (c.fly) {
        cam.lookAtTransform(C.Matrix4.IDENTITY);
        const sphere = new C.BoundingSphere(target, Math.max(1, c.rangeM * 0.15));
        cam.flyToBoundingSphere(sphere, { duration: 1.2, offset });
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
            outlineWidth: 3,
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
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    this.widget.resolutionScale = Math.min(q.resolutionScale, 2 / dpr);
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
            this.scene.terrainProvider = await C.CesiumTerrainProvider.fromUrl(t.url, {
              requestVertexNormals: true,
              requestWaterMask: false,
            });
            break;
          case 'cesium-ion':
            this.scene.terrainProvider = await C.CesiumTerrainProvider.fromIonAssetId(
              t.assetId ?? 1,
              {
                requestVertexNormals: true,
                ...(this.ionToken ? { accessToken: this.ionToken } : {}),
              },
            );
            break;
        }
      } catch (error) {
        this.onError?.('Terrain unavailable — showing flat ground', error);
        this.scene.terrainProvider = new C.EllipsoidTerrainProvider();
      }
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
    } catch (error) {
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
      drawCalls: null,
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
              pickPositionSupported: scene.pickPositionSupported,
              pickPosition: (w) => {
                const r = scene.pickPosition(new C.Cartesian2(w.x, w.y));
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

  destroy(): void {
    this.preRenderRemover?.();
    this.pickHandler?.destroy();
    this.widget.destroy();
  }
}

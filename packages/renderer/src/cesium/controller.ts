/**
 * SceneController: SceneState in, host calls out. Cheap things (light direction, grade uniforms,
 * camera) apply immediately on every scrub tick; expensive things (terrain detail, shadow map
 * size, provider swaps) are debounced and diffed (plan §4 "debounce expensive visual refresh").
 */
import { sunPosition } from '@lightmap/astronomy';
import type { CameraState, SceneState } from '@lightmap/scene';
import type { BasemapDescriptor, TerrainDescriptor } from '@lightmap/geospatial';
import { lightingFromScene, type LightingParameters } from '../lighting.ts';
import { enuTowardSun, enuToEcef } from '../sun-vector.ts';
import type { HostCamera, HostGradeUniforms, HostOverlay, SceneHost } from './host.ts';
import type { OrbitView } from '../camera-math.ts';
import { clampOrbit, defaultOrbit } from '../camera-math.ts';

/**
 * Cesium's `frustum.fov` is the horizontal angle when the viewport is wider than tall, otherwise
 * the vertical one. LightMap's CameraState stores horizontal FOV, so in portrait we convert.
 */
export function cesiumFovDeg(horizontalFovDeg: number, aspect: number): number {
  if (aspect >= 1) return horizontalFovDeg;
  const half = Math.tan((horizontalFovDeg * Math.PI) / 360);
  return (2 * Math.atan(half / aspect) * 180) / Math.PI;
}

export interface ControllerOptions {
  /** Debounce for expensive updates, ms. */
  expensiveDebounceMs?: number;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  /** Viewport aspect ratio provider (width / height). */
  aspect?: () => number;
  /** Radius of the sun-path overlay sphere. */
  overlayRadiusM?: number;
  /** Injected clock for tests. */
  now?: () => number;
}

export class SceneController {
  private readonly host: SceneHost;
  private readonly debounceMs: number;
  private readonly setTimeoutImpl: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutImpl: (handle: unknown) => void;
  private readonly aspect: () => number;
  private readonly overlayRadiusM: number;
  private pendingExpensive: unknown = null;
  private lastTerrain: string | null = null;
  private lastBasemap: string | null = null;
  private lastShadowKey: string | null = null;
  private lastQualityKey: string | null = null;
  private lastCelestial: string | null = null;
  private lastDayKey: string | null = null;
  private groundHeightM = 0;
  private groundHeightKey: string | null = null;
  private orbit: OrbitView = defaultOrbit();
  private lastScene: SceneState | null = null;
  /** While a fly-to is in progress, non-fly orbit updates are suppressed so they do not cut it short. */
  private flyUntil = 0;
  private pendingCameraRetry: unknown = null;
  private readonly now: () => number;
  private lastLighting: LightingParameters | null = null;

  constructor(host: SceneHost, options: ControllerOptions = {}) {
    this.host = host;
    this.debounceMs = options.expensiveDebounceMs ?? 250;
    this.setTimeoutImpl = options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.aspect = options.aspect ?? (() => 16 / 9);
    this.overlayRadiusM = options.overlayRadiusM ?? 400;
    this.now = options.now ?? (() => Date.now());
  }

  get lighting(): LightingParameters | null {
    return this.lastLighting;
  }

  /** Configure providers (idempotent; awaits the swap). */
  async setProviders(terrain: TerrainDescriptor, basemap: BasemapDescriptor): Promise<void> {
    const tKey = JSON.stringify(terrain);
    const bKey = JSON.stringify(basemap);
    const jobs: Promise<void>[] = [];
    if (tKey !== this.lastTerrain) {
      this.lastTerrain = tKey;
      this.groundHeightKey = null;
      jobs.push(this.host.setTerrain(terrain));
    }
    if (bKey !== this.lastBasemap) {
      this.lastBasemap = bKey;
      jobs.push(this.host.setBasemap(basemap));
    }
    await Promise.all(jobs);
    if (this.lastScene) await this.refreshGroundHeight(this.lastScene);
  }

  /** Orbit view for map mode; the React layer updates it from drag gestures. */
  setOrbit(view: Partial<OrbitView>): void {
    this.orbit = clampOrbit({ ...this.orbit, ...view });
    if (this.lastScene) this.applyCamera(this.lastScene, false);
  }

  get orbitView(): OrbitView {
    return this.orbit;
  }

  /** Apply a new SceneState. Called on every timeline tick. */
  apply(scene: SceneState): void {
    const prev = this.lastScene;
    this.lastScene = scene;
    const lighting = lightingFromScene(scene);
    this.lastLighting = lighting;

    // --- cheap, every tick -----------------------------------------------------------------
    this.host.setTime(scene.utc);
    this.host.setLight({
      directionEcef: lighting.lightDirectionEcef,
      color: lighting.sunColor,
      intensity: lighting.sunIntensity,
    });
    this.host.setAtmosphere({ ...lighting.atmosphere, fogDensity: lighting.fogDensity });
    const toward = enuToEcef(
      enuTowardSun(scene.solar.azimuthDegrees, scene.solar.elevationDegrees),
      scene.location.point.latitude,
      scene.location.point.longitude,
    );
    const sunScreen = this.host.sunScreenPosition(toward);
    const uniforms: HostGradeUniforms = {
      u_saturation: lighting.grade.saturation,
      u_contrast: lighting.grade.contrast,
      u_warmth: lighting.grade.warmth,
      u_tint: lighting.grade.tint,
      u_haze: lighting.grade.haze,
      u_cloudCoverage: lighting.grade.cloudCoverage,
      u_cloudDensity: lighting.grade.cloudDensity,
      u_cloudOpacity: lighting.grade.cloudOpacity,
      u_skyLuminance: lighting.grade.skyLuminance,
      u_nightFactor: lighting.grade.nightFactor,
      u_precipitation: lighting.grade.precipitation,
      // Clouds drift with the selected time, not the wall clock, so scrubbing reads as motion.
      u_time: (scene.utc.getTime() / 60_000) % 100_000,
      u_sunScreen: sunScreen ?? [-1, -1],
      u_sunVisible: sunScreen && lighting.directLightPresent ? 1 : 0,
    };
    this.host.setGrade(uniforms);

    const pinMoved =
      !prev ||
      prev.location.point.latitude !== scene.location.point.latitude ||
      prev.location.point.longitude !== scene.location.point.longitude;
    const modeChanged = !prev || prev.camera.mode !== scene.camera.mode;
    this.applyCamera(scene, pinMoved || modeChanged);
    this.applyOverlay(scene);

    // Shadows toggle is cheap; size/softness is expensive.
    const shadowKey = `${lighting.shadowsEnabled}|${scene.render.shadowMapSize}|${scene.render.softShadows}`;
    if (shadowKey !== this.lastShadowKey) {
      this.lastShadowKey = shadowKey;
      this.host.setShadows({
        enabled: lighting.shadowsEnabled,
        darkness: lighting.shadowDarkness,
        size: scene.render.shadowMapSize,
        softShadows: scene.render.softShadows,
      });
    } else if (lighting.shadowsEnabled) {
      this.host.setShadows({
        enabled: true,
        darkness: lighting.shadowDarkness,
        size: scene.render.shadowMapSize,
        softShadows: scene.render.softShadows,
      });
    }

    const viewpoint = scene.camera.mode === 'viewpoint';
    const celestialKey = `${viewpoint}|${lighting.starsVisible}|${scene.lunar?.isAboveHorizon ?? false}`;
    if (celestialKey !== this.lastCelestial) {
      this.lastCelestial = celestialKey;
      this.host.setCelestialBodies({
        sun: viewpoint && scene.solar.elevationDegrees > -1,
        // Cesium's Moon mesh is lit by Cesium's own Sun, so at night it renders as a black disc;
        // the moonlit atmosphere lobe (lighting.ts) marks the Moon's position instead. v0.1: off.
        moon: false,
        stars: viewpoint && lighting.starsVisible,
      });
    }

    // --- expensive, debounced -------------------------------------------------------------
    const qualityKey = `${scene.render.terrainScreenSpaceError}|${scene.render.resolutionScale}`;
    if (qualityKey !== this.lastQualityKey || pinMoved) {
      this.scheduleExpensive(() => {
        if (qualityKey !== this.lastQualityKey) {
          this.lastQualityKey = qualityKey;
          this.host.setQuality({
            terrainScreenSpaceError: scene.render.terrainScreenSpaceError,
            resolutionScale: scene.render.resolutionScale,
          });
        }
        if (pinMoved) void this.refreshGroundHeight(scene);
      });
    }
    this.host.requestRender();
  }

  private applyCamera(scene: SceneState, fly: boolean): void {
    const cam: CameraState = scene.camera;
    const p = scene.location.point;
    const ground = this.groundHeightM;
    let hostCam: HostCamera;
    if (cam.mode === 'viewpoint') {
      hostCam = {
        kind: 'viewpoint',
        eye: cam.eye,
        heightM: ground + cam.eyeHeightM,
        headingDeg: cam.headingDeg,
        pitchDeg: cam.pitchDeg,
        fovDeg: cesiumFovDeg(cam.fovDeg, this.aspect()),
      };
    } else {
      // Reduced motion (plan §28): jump instead of flying; no pending-retry dance either.
      if (scene.render.reducedMotion) fly = false;
      if (fly) this.flyUntil = this.now() + 1400;
      else if (this.now() < this.flyUntil) {
        // Let the flight finish, then apply the (possibly corrected) orbit once.
        if (this.pendingCameraRetry === null) {
          this.pendingCameraRetry = this.setTimeoutImpl(
            () => {
              this.pendingCameraRetry = null;
              if (this.lastScene) this.applyCamera(this.lastScene, false);
              this.host.requestRender();
            },
            Math.max(0, this.flyUntil - this.now()),
          );
        }
        return;
      }
      hostCam = {
        kind: 'orbit',
        target: p,
        targetHeightM: ground,
        headingDeg: this.orbit.headingDeg,
        pitchDeg: this.orbit.pitchDeg,
        rangeM: this.orbit.rangeM,
        fly,
      };
    }
    this.host.setCamera(hostCam);
  }

  private applyOverlay(scene: SceneState): void {
    const dayKey = `${scene.dayEvents.date}|${scene.location.point.latitude}|${scene.location.point.longitude}`;
    let sunPath: HostOverlay['sunPath'] = this.cachedSunPath ?? [];
    if (dayKey !== this.lastDayKey || this.cachedSunPath === null) {
      this.lastDayKey = dayKey;
      sunPath = sunPathForDay(scene);
      this.cachedSunPath = sunPath;
    }
    const overlay: HostOverlay = {
      pin: { ...scene.location.point, heightM: this.groundHeightM },
      sunPath,
      sun:
        scene.solar.elevationDegrees > -0.833
          ? { azimuthDeg: scene.solar.azimuthDegrees, elevationDeg: scene.solar.elevationDegrees }
          : null,
      shadowAzimuthDeg:
        scene.solar.elevationDegrees > 0.1 ? (scene.solar.azimuthDegrees + 180) % 360 : null,
      radiusM: this.overlayRadiusM,
      visible: scene.camera.mode === 'map',
    };
    this.host.setOverlay(overlay);
  }
  private cachedSunPath: HostOverlay['sunPath'] | null = null;

  private scheduleExpensive(fn: () => void): void {
    if (this.pendingExpensive !== null) this.clearTimeoutImpl(this.pendingExpensive);
    this.pendingExpensive = this.setTimeoutImpl(() => {
      this.pendingExpensive = null;
      fn();
      this.host.requestRender();
    }, this.debounceMs);
  }

  private async refreshGroundHeight(scene: SceneState): Promise<void> {
    const key = `${scene.location.point.latitude},${scene.location.point.longitude}|${this.lastTerrain ?? ''}`;
    if (key === this.groundHeightKey) return;
    this.groundHeightKey = key;
    const h = await this.host.sampleGroundHeight(scene.location.point);
    const next = h ?? scene.location.point.elevationM ?? scene.environment.groundElevationM ?? 0;
    if (next !== this.groundHeightM && this.lastScene) {
      this.groundHeightM = next;
      this.applyCamera(this.lastScene, false);
      this.applyOverlay(this.lastScene);
      this.host.requestRender();
    }
  }

  get groundHeight(): number {
    return this.groundHeightM;
  }

  destroy(): void {
    if (this.pendingExpensive !== null) this.clearTimeoutImpl(this.pendingExpensive);
    if (this.pendingCameraRetry !== null) this.clearTimeoutImpl(this.pendingCameraRetry);
    this.host.destroy();
  }
}

/** Sun positions through the civil day, every 10 minutes while above the horizon. */
export function sunPathForDay(
  scene: SceneState,
  stepMinutes = 10,
): Array<{ azimuthDeg: number; elevationDeg: number }> {
  const out: Array<{ azimuthDeg: number; elevationDeg: number }> = [];
  const start = scene.dayEvents.dayStart.getTime();
  const end = scene.dayEvents.dayEnd.getTime();
  for (let t = start; t <= end; t += stepMinutes * 60_000) {
    const s = sunAt(new Date(t), scene);
    if (s.elevationDeg > -1) out.push(s);
  }
  return out;
}

function sunAt(t: Date, scene: SceneState): { azimuthDeg: number; elevationDeg: number } {
  const p = sunPosition(t, scene.location.point.latitude, scene.location.point.longitude);
  return { azimuthDeg: p.azimuthDeg, elevationDeg: p.elevationDeg };
}

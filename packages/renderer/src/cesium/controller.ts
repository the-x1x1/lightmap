/**
 * SceneController: SceneState in, host calls out. Cheap things (light direction, grade uniforms,
 * camera) apply immediately on every scrub tick; expensive things (terrain detail, shadow map
 * size, provider swaps) are debounced and diffed (plan §4 "debounce expensive visual refresh").
 */
import { localDayBounds, sunPosition } from '@lightmap/astronomy';
import {
  aboveTerrain,
  coreTrackPosition,
  moonTrackPosition,
  type CameraState,
  type HorizonProfile,
  type SceneState,
} from '@lightmap/scene';
import type { BasemapDescriptor, TerrainDescriptor } from '@lightmap/geospatial';
import { lightingFromScene, type LightingParameters } from '../lighting.ts';
import { enuTowardSun, enuToEcef } from '../sun-vector.ts';
import type {
  HostCamera,
  HostGlobeShading,
  HostGradeUniforms,
  HostOverlay,
  SceneHost,
} from './host.ts';
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
  private lastShadingKey: string | null = null;
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
    // A destroyed host (the renderer was torn down — React's StrictMode replays effects, a
    // quality change rebuilds the view) has no scene to drive; the stale apply is dropped.
    if (this.host.isDestroyed()) return;
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
    const shading = globeShadingFor(scene, lighting);
    const shadingKey = `${shading.lit}|${shading.basemapBrightness.toFixed(2)}`;
    if (shadingKey !== this.lastShadingKey) {
      this.lastShadingKey = shadingKey;
      this.host.setGlobeShading(shading);
    }
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
      u_cloudLow: lighting.grade.cloudLow,
      u_cloudMid: lighting.grade.cloudMid,
      u_cloudHigh: lighting.grade.cloudHigh,
      u_skyLuminance: lighting.grade.skyLuminance,
      u_nightFactor: lighting.grade.nightFactor,
      u_precipitation: lighting.grade.precipitation,
      u_horizonHaze: lighting.grade.horizonHaze,
      u_sunElevation: lighting.grade.sunElevation,
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
    const maximumDistance = shadowReachM(scene, this.orbit.rangeM);
    const shadowKey = `${lighting.shadowsEnabled}|${scene.render.shadowMapSize}|${scene.render.softShadows}|${maximumDistance}`;
    if (shadowKey !== this.lastShadowKey) {
      this.lastShadowKey = shadowKey;
      this.host.setShadows({
        enabled: lighting.shadowsEnabled,
        darkness: lighting.shadowDarkness,
        size: scene.render.shadowMapSize,
        softShadows: scene.render.softShadows,
        maximumDistance,
      });
    } else if (lighting.shadowsEnabled) {
      this.host.setShadows({
        enabled: true,
        darkness: lighting.shadowDarkness,
        size: scene.render.shadowMapSize,
        softShadows: scene.render.softShadows,
        maximumDistance,
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
    const profile = scene.terrainHorizon?.profile ?? null;
    let sunPath: HostOverlay['sunPath'] = this.cachedSunPath ?? [];
    if (
      dayKey !== this.lastDayKey ||
      profile !== this.lastPathProfile ||
      this.cachedSunPath === null
    ) {
      this.lastDayKey = dayKey;
      this.lastPathProfile = profile;
      sunPath = sunPathForDay(scene);
      this.cachedSunPath = sunPath;
    }
    // Night paths ride on the lunar state (moon planning) and change with the day, not the scrub.
    const nightKey = `${dayKey}|${scene.lunar ? 'moon' : ''}`;
    if (nightKey !== this.lastNightKey || this.cachedNightPaths === null) {
      this.lastNightKey = nightKey;
      this.cachedNightPaths = nightPathsForDay(scene);
    }
    const yearKey = `${scene.dayEvents.date.slice(0, 4)}|${scene.location.point.latitude}|${scene.location.point.longitude}`;
    if (yearKey !== this.lastYearKey || this.cachedSeasonPaths === null) {
      this.lastYearKey = yearKey;
      this.cachedSeasonPaths = seasonPathsForYear(scene);
    }
    const overlay: HostOverlay = {
      pin: { ...scene.location.point, heightM: this.groundHeightM },
      sunPath,
      seasonPaths: this.cachedSeasonPaths,
      nightPaths: this.cachedNightPaths,
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
  private lastPathProfile: HorizonProfile | null = null;
  private cachedSeasonPaths: HostOverlay['seasonPaths'] | null = null;
  private lastYearKey = '';
  private cachedNightPaths: HostOverlay['nightPaths'] | null = null;
  private lastNightKey = '';

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

/**
 * The map view is a chart: once the Sun is under the horizon and nothing else lights the
 * ground, real lighting would leave it black, so the basemap is shown flat and dimmed (the
 * darker the sky, the dimmer the chart — down to 45 % in astronomical night) while the sun,
 * sky and night overlays carry the hour. The viewpoint view always keeps true lighting.
 */
export function globeShadingFor(
  scene: Pick<SceneState, 'camera' | 'solar'>,
  lighting: Pick<LightingParameters, 'sunIntensity'>,
): HostGlobeShading {
  if (scene.camera.mode === 'viewpoint') return { lit: true, basemapBrightness: 1 };
  const el = scene.solar.elevationDegrees;
  if (el > -0.833 && lighting.sunIntensity > 0.05) return { lit: true, basemapBrightness: 1 };
  // −0.833° → 0.9, −18° and below → 0.45.
  const t = Math.min(1, Math.max(0, (-0.833 - el) / (18 - 0.833)));
  return { lit: false, basemapBrightness: 0.9 - 0.45 * t };
}

/** Sun positions through the civil day, every 10 minutes while above the horizon. */
export function sunPathForDay(scene: SceneState, stepMinutes = 10): HostOverlay['sunPath'] {
  const out: HostOverlay['sunPath'] = [];
  const start = scene.dayEvents.dayStart.getTime();
  const end = scene.dayEvents.dayEnd.getTime();
  const profile = scene.terrainHorizon?.profile ?? null;
  for (let t = start; t <= end; t += stepMinutes * 60_000) {
    const s = sunAt(new Date(t), scene);
    if (s.elevationDeg > -1)
      out.push(
        profile ? { ...s, behindTerrain: !aboveTerrain(profile, s.azimuthDeg, s.elevationDeg) } : s,
      );
  }
  return out;
}

/**
 * The sun's paths on the two solstices of the scene's year (plan §1 "seasonal path"), every 15
 * minutes while above the horizon: the envelope every other day's arc lies within. Empty for a
 * polar solstice with no daylight.
 */
export function seasonPathsForYear(
  scene: SceneState,
  stepMinutes = 15,
): HostOverlay['seasonPaths'] {
  const year = Number(scene.dayEvents.date.slice(0, 4));
  const out: HostOverlay['seasonPaths'] = [];
  for (const month of [6, 12] as const) {
    const { start, end } = localDayBounds({ year, month, day: 21 }, scene.location.timeZone);
    const path: Array<{ azimuthDeg: number; elevationDeg: number }> = [];
    for (let t = start.getTime(); t <= end.getTime(); t += stepMinutes * 60_000) {
      const s = sunAt(new Date(t), scene);
      if (s.elevationDeg > -1) path.push(s);
    }
    if (path.length > 1) out.push(path);
  }
  return out;
}

/**
 * The Moon's path while it is up and the Milky Way core's track through the dark hours of the
 * civil day (night planning), each as unbroken runs — a Moon that sets and rises again in one day
 * is two runs, never a chord across the sky. Empty without the lunar state.
 */
export function nightPathsForDay(scene: SceneState, stepMinutes = 10): HostOverlay['nightPaths'] {
  if (!scene.lunar) return [];
  const out: HostOverlay['nightPaths'] = [];
  const { dayStart, dayEnd } = scene.dayEvents;
  const point = scene.location.point;
  const tracks = [
    ['moon', moonTrackPosition(point)],
    ['core', coreTrackPosition(point)],
  ] as const;
  for (const [kind, positionAt] of tracks) {
    let run: Array<{ azimuthDeg: number; elevationDeg: number }> = [];
    for (let t = dayStart.getTime(); t <= dayEnd.getTime(); t += stepMinutes * 60_000) {
      const p = positionAt(new Date(t));
      if (p) run.push(p);
      else if (run.length) {
        if (run.length > 1) out.push({ kind, points: run });
        run = [];
      }
    }
    if (run.length > 1) out.push({ kind, points: run });
  }
  return out;
}

function sunAt(t: Date, scene: SceneState): { azimuthDeg: number; elevationDeg: number } {
  const p = sunPosition(t, scene.location.point.latitude, scene.location.point.longitude);
  return { azimuthDeg: p.azimuthDeg, elevationDeg: p.elevationDeg };
}

/**
 * Shadow reach (metres) for the shadow map's cascades. Eye level: 20 km, so a ridge's shadow
 * reaches across a valley at low sun while the near ground stays crisp with a 2048–4096 map. Map
 * view: grows with the orbit range so shadows do not stop at an arbitrary line inside the frame,
 * and is capped where a shadow map stops resolving anything useful.
 */
export function shadowReachM(scene: SceneState, orbitRangeM: number): number {
  if (scene.camera.mode === 'viewpoint') return 20_000;
  const reach = Math.round(orbitRangeM * 3);
  return Math.max(8_000, Math.min(60_000, Math.round(reach / 1000) * 1000));
}

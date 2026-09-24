/**
 * SceneHost: everything the controller does to the 3D scene, as a narrow interface. The real
 * implementation (`cesium-host.ts`) is the ONE file typed against `@cesium/engine`; tests drive
 * the controller with a fake host. (Pattern adopted from the owner's WorldView `CesiumLike`;
 * interface written fresh for LightMap — docs/WORLDVIEW_REUSE_AUDIT.md.)
 */
import type { GeoPoint, BasemapDescriptor, TerrainDescriptor } from '@lightmap/geospatial';
import type { Vec3 } from '../sun-vector.ts';

export interface HostLight {
  directionEcef: Vec3;
  color: [number, number, number];
  intensity: number;
}

export interface HostShadows {
  enabled: boolean;
  darkness: number;
  size: number;
  softShadows: boolean;
  /**
   * How far from the camera shadows are resolved, metres. Cesium spreads its cascades over this
   * distance, so it is a trade between reach (a ridge's shadow across a valley) and crispness near
   * the camera; the controller picks it from the camera mode and altitude.
   */
  maximumDistance: number;
}

export interface HostAtmosphere {
  hueShift: number;
  saturationShift: number;
  brightnessShift: number;
  lightIntensity: number;
  fogDensity: number;
}

export interface HostGradeUniforms {
  u_saturation: number;
  u_contrast: number;
  u_warmth: number;
  u_tint: [number, number, number];
  u_haze: number;
  u_cloudCoverage: number;
  u_cloudDensity: number;
  u_cloudOpacity: number;
  u_cloudLow: number;
  u_cloudMid: number;
  u_cloudHigh: number;
  u_skyLuminance: number;
  u_nightFactor: number;
  u_precipitation: number;
  u_horizonHaze: number;
  u_sunElevation: number;
  u_time: number;
  u_sunScreen: [number, number];
  u_sunVisible: number;
}

export interface HostViewpointCamera {
  kind: 'viewpoint';
  eye: GeoPoint;
  /** Absolute height of the eye above the ellipsoid, metres (ground + eye height). */
  heightM: number;
  headingDeg: number;
  pitchDeg: number;
  /** Cesium frustum fov in degrees, already adjusted for aspect (see `cesiumFovDeg`). */
  fovDeg: number;
}

export interface HostOrbitCamera {
  kind: 'orbit';
  target: GeoPoint;
  targetHeightM: number;
  headingDeg: number;
  pitchDeg: number;
  rangeM: number;
  /** Animate the transition. */
  fly: boolean;
}

export type HostCamera = HostViewpointCamera | HostOrbitCamera;

export interface HostOverlay {
  pin: (GeoPoint & { heightM: number }) | null;
  /** Points on the sun's path for the day, as az/el pairs; drawn on a sphere of `radiusM` around the pin. */
  sunPath: Array<{ azimuthDeg: number; elevationDeg: number }>;
  sun: { azimuthDeg: number; elevationDeg: number } | null;
  shadowAzimuthDeg: number | null;
  radiusM: number;
  visible: boolean;
}

export interface HostQuality {
  terrainScreenSpaceError: number;
  resolutionScale: number;
}

export interface HostStats {
  fps: number;
  terrainTilesLoaded: number;
  terrainTilesLoading: number;
  drawCalls: number | null;
  /** Cesium's own sun direction (toward the Sun, ECEF), for the consistency check. */
  cesiumSunDirectionEcef: Vec3 | null;
}

export interface SceneHost {
  setTime(utc: Date): void;
  setLight(light: HostLight): void;
  setShadows(s: HostShadows): void;
  setAtmosphere(a: HostAtmosphere): void;
  setGrade(u: HostGradeUniforms): void;
  setCamera(c: HostCamera): void;
  setOverlay(o: HostOverlay): void;
  setQuality(q: HostQuality): void;
  setTerrain(t: TerrainDescriptor): Promise<void>;
  setBasemap(b: BasemapDescriptor): Promise<void>;
  /** Sun disc / moon / stars in the sky (viewpoint mode; stars only when dark). */
  setCelestialBodies(v: { sun: boolean; moon: boolean; stars: boolean }): void;
  /** Screen position (0..1) of a world direction from the camera, or null when behind. */
  sunScreenPosition(directionTowardSunEcef: Vec3): [number, number] | null;
  /** Ground height at a point once terrain is loaded; null when unknown. */
  sampleGroundHeight(p: GeoPoint): Promise<number | null>;
  requestRender(): void;
  stats(): HostStats;
  /** Subscribe to clicks/taps on the ground. */
  onPick(handler: (p: GeoPoint & { viaTerrain: boolean }) => void): () => void;
  /** Subscribe to per-second frame samples. */
  onFrameSample(handler: (fps: number) => void): () => void;
  resize(): void;
  /** PNG data URL of the current frame (thumbnails for saved viewpoints). */
  captureThumbnail(maxWidth: number): Promise<string | null>;
  destroy(): void;
}

/**
 * SceneHost: everything the controller does to the 3D scene, as a narrow interface. The real
 * implementation (`cesium-host.ts`) is the ONE file typed against `@cesium/engine`; tests drive
 * the controller with a fake host. (Pattern adopted from the owner's WorldView `CesiumLike`;
 * interface written fresh for LightMap — docs/WORLDVIEW_REUSE_AUDIT.md.)
 */
import type {
  GeoPoint,
  BasemapDescriptor,
  BuildingsDescriptor,
  LandCoverDescriptor,
  TerrainDescriptor,
} from '@lightmap/geospatial';
import type { Vec3 } from '../sun-vector.ts';

export interface HostLight {
  directionEcef: Vec3;
  color: [number, number, number];
  intensity: number;
}

/**
 * How the globe itself is shaded. In the map view at night the real lighting leaves the chart
 * black, so the map falls back to a dimmed, unlit basemap: a chart the photographer can still
 * read, with the sun and sky overlays carrying the hour. The viewpoint view keeps true lighting.
 */
export interface HostGlobeShading {
  /** Shade the terrain with the scene light (true) or show the basemap flat (false). */
  lit: boolean;
  /** Basemap brightness, 1 by day; the unlit night chart is dimmed below it. */
  basemapBrightness: number;
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
  /**
   * Sea-level aerosol (Mie) scattering coefficient for the dome and the ground atmosphere, m⁻¹,
   * from the sky model (feature flag `physicalSkyDome`); absent ⇒ Cesium's default stays.
   */
  mieCoefficient?: number;
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
  /**
   * Points on the sun's path for the day, as az/el pairs; drawn on a sphere of `radiusM` around
   * the pin. `behindTerrain` marks points below the sampled terrain horizon (drawn dashed-dark
   * over the path); absent when no terrain horizon exists.
   */
  sunPath: Array<{ azimuthDeg: number; elevationDeg: number; behindTerrain?: boolean }>;
  /**
   * The year's bounds (plan §1 "seasonal path"): the sun's path on the June and December
   * solstices, drawn faint on the same sphere so the day's arc is seen against where it can be.
   * Empty when not wanted.
   */
  seasonPaths: Array<Array<{ azimuthDeg: number; elevationDeg: number }>>;
  /**
   * Night planning on the same sphere: the Moon's path while it is up (grey) and the Milky Way
   * core's track through the dark hours (violet), one run per unbroken spell; empty without the
   * lunar state.
   */
  nightPaths: Array<{
    kind: 'moon' | 'core';
    points: Array<{ azimuthDeg: number; elevationDeg: number }>;
  }>;
  sun: { azimuthDeg: number; elevationDeg: number } | null;
  shadowAzimuthDeg: number | null;
  radiusM: number;
  visible: boolean;
}

/** What a land-cover read around the pin found (`land-cover.ts` `CoverMap` without the pixels). */
export interface LandCoverReading {
  /** Share of the mosaic's pixels the palette knew, 0–1. */
  known: number;
  /** Class shares over the known pixels. */
  shares: Partial<Record<string, number>>;
  /** Ground size of a cover-map pixel, metres. */
  metresPerPixel: number;
}

/** The procedural ground surface's inputs (`ground-texture.ts`); null switches it off. */
export interface HostGroundTexture {
  snowlineM: number;
  treelineM: number;
  poleward: number;
  strength: number;
  aridity: number;
  ice: number;
  brightness: number;
  seaLevelM: number;
  /** 1 when the sea level was measured: only then is flat ground near it painted as shore. */
  shore: 0 | 1;
  cloudShadow: number;
  wet: number;
  detail: 0 | 1 | 2;
  /** The leaf season (leaf-season.ts); summer when left out. */
  leafOn?: number;
  autumn?: number;
  grassGreen?: number;
  /** The share of broad-leaf crowns that are deciduous (`LeafSeason.deciduous`); all when left out. */
  deciduous?: number;
  /** Lying snow in the lowlands, 0-1 (snow-season.ts); none when left out. */
  snowCover?: number;
}

export interface HostQuality {
  terrainScreenSpaceError: number;
  resolutionScale: number;
  /** Multisample anti-aliasing, 1 (off: FXAA instead), 2 or 4. */
  msaaSamples?: number;
}

export interface HostStats {
  fps: number;
  terrainTilesLoaded: number;
  terrainTilesLoading: number;
  /** Cesium's pre-cull draw-command count for the last frame (null when unavailable). */
  drawCalls: number | null;
  /** Cesium's own sun direction (toward the Sun, ECEF), for the consistency check. */
  cesiumSunDirectionEcef: Vec3 | null;
}

/** The Moon as the viewpoint sees it (`setMoonDisc`). */
export interface HostMoonDisc {
  /** Unit vector from the eye toward the Moon (topocentric), ECEF. */
  directionEcef: Vec3;
  /** Unit vector toward the Sun, ECEF: the bright limb faces it. */
  towardSunEcef: Vec3;
  /** 0 new … 1 full. */
  illuminatedFraction: number;
  /** Apparent diameter, degrees. */
  diameterDeg: number;
  /** 0–1: paler by day, full at night. */
  opacity: number;
  /** How strongly it lights the haze and thin cloud around it, 0-1 (`moonGlowStrength`). */
  glow?: number;
  /** The disc's colour and dimming by the air where it stands, linear 0-1 (`moonDiscTint`). */
  tint?: [number, number, number];
}

/** A planet as the viewpoint's sky draws it (`setPlanets`, `planet-points.ts`). */
export interface HostPlanet {
  /** Unit vector from the eye toward the planet, ECEF. */
  directionEcef: Vec3;
  /** Peak brightness of its point, 0-1. */
  peak: number;
  /** Gaussian radius of its point, CSS pixels. */
  sigmaPx: number;
}

/** The Sun the grade's glare is drawn around (`setSunGlare`). */
export interface HostSunGlare {
  /** Unit vector toward the Sun, ECEF. */
  towardEcef: Vec3;
  /** Whether the Sun lights the scene directly (no glare through overcast or below the horizon). */
  lit: boolean;
  /** The colour of its direct light at its elevation, brightest channel 1 (`directLightTint`). */
  tint?: [number, number, number];
}

export interface SceneHost {
  setTime(utc: Date): void;
  setLight(light: HostLight): void;
  setGlobeShading(shading: HostGlobeShading): void;
  setShadows(s: HostShadows): void;
  setAtmosphere(a: HostAtmosphere): void;
  setGrade(u: HostGradeUniforms): void;
  setCamera(c: HostCamera): void;
  setOverlay(o: HostOverlay): void;
  setQuality(q: HostQuality): void;
  /** Paint (or clear) the procedural ground texture over the basemap. */
  setGroundTexture(g: HostGroundTexture | null): void;
  /** The public ion token once capabilities arrive (ion terrain, imagery and buildings use it). */
  setIonToken(token: string | undefined): void;
  setTerrain(t: TerrainDescriptor): Promise<void>;
  setBasemap(b: BasemapDescriptor): Promise<void>;
  /** 3D buildings over the terrain (lit and shadow-casting like it); `none` removes them. */
  setBuildings(b: BuildingsDescriptor): Promise<void>;
  /** The land-cover tile source the ground texture may read (`none` clears any cover map). */
  setLandCover(d: LandCoverDescriptor): void;
  /**
   * Read the land-cover tiles around a point into the ground material's cover map. Resolves to
   * what was read (the known share and class shares) or null when there is no source, the
   * tiles could not be fetched, or the palette knew none of their colours (the map is then off).
   */
  loadLandCoverAround(p: GeoPoint): Promise<LandCoverReading | null>;
  /** Sun disc / moon / stars in the sky (viewpoint mode; stars only when dark). */
  setCelestialBodies(v: { sun: boolean; moon: boolean; stars: boolean }): void;
  /** The Moon drawn in the viewpoint's sky with its phase and size; null hides it. */
  setMoonDisc?(m: HostMoonDisc | null): void;
  /**
   * Where the grade's sun glare sits, placed by the host each frame (so it follows the clock's
   * glide and the camera between applies); without it `u_sunScreen` is used as given.
   */
  setSunGlare?(glare: HostSunGlare | null): void;
  /**
   * The naked-eye planets in the viewpoint's sky, in `PLANETS` order (Mercury, Venus, Mars,
   * Jupiter, Saturn; null for one not shown); null hides them all.
   */
  setPlanets?(planets: ReadonlyArray<HostPlanet | null> | null): void;
  /** Screen position (0..1) of a world direction from the camera, or null when behind. */
  sunScreenPosition(directionTowardSunEcef: Vec3): [number, number] | null;
  /**
   * The bundled coarse basemap's pixels (sRGB 0–255, a small neighbourhood) around a point —
   * the ground texture's regional land hint; null when the basemap is not loaded or readable.
   */
  sampleBasemapPixels(p: GeoPoint): Promise<Array<[number, number, number]> | null>;
  /** Ground height at a point once terrain is loaded; null when unknown. */
  sampleGroundHeight(p: GeoPoint): Promise<number | null>;
  /**
   * Sea level's height above the ellipsoid at a point (the EGM96 geoid, from the bundled
   * cells), in the terrain's own frame; null without real terrain or the bundled cells.
   */
  sampleSeaLevel(p: GeoPoint): Promise<number | null>;
  /**
   * Terrain heights for many points at a fixed tile level (lower = coarser, cheaper; ~9 for far
   * rings, ~13 near the viewpoint). Null per point when unknown; all zeros on the ellipsoid.
   */
  sampleGroundHeights(points: readonly GeoPoint[], level: number): Promise<Array<number | null>>;
  /**
   * Heights above the ellipsoid of the topmost mapped surface at points — a building's roof
   * where one stands (the loaded 3D buildings at their finest detail), the terrain only where
   * the globe happens to be in view; null when there are no buildings to sample (then the
   * terrain heights stand alone), null per point where nothing was hit (the caller keeps its
   * terrain height there).
   */
  sampleSurfaceHeights(points: readonly GeoPoint[]): Promise<Array<number | null> | null>;
  /**
   * Whether a mapped building's footprint holds the point: false where the loaded footprints
   * say none does (a surface above the terrain there is the coarse globe, not a roof), null
   * when the host cannot tell (3D Tiles buildings, or the tile not read yet).
   */
  hasBuildingAt?(point: GeoPoint): boolean | null;
  /**
   * Whether the terrain carries vertex normals (lit by Cesium's vertex lighting, with its 0.3
   * ambient share) rather than the ellipsoid's day/night shading (full light at map heights).
   */
  terrainHasNormals?(): boolean;
  requestRender(): void;
  stats(): HostStats;
  /** The ground under a canvas point (CSS px from its top left), or null for the sky. */
  pickAt?(x: number, y: number): (GeoPoint & { viaTerrain: boolean }) | null;
  /** Subscribe to clicks/taps on the ground. */
  onPick(handler: (p: GeoPoint & { viaTerrain: boolean }) => void): () => void;
  /** Subscribe to per-second frame samples. */
  onFrameSample(handler: (fps: number) => void): () => void;
  resize(): void;
  /** True once `destroy()` has run; every other method is then a no-op for the caller to skip. */
  isDestroyed(): boolean;
  /** PNG data URL of the current frame (thumbnails for saved viewpoints). */
  captureThumbnail(maxWidth: number): Promise<string | null>;
  destroy(): void;
}

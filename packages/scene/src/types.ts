/**
 * SceneState (plan §24): the single model that combines location, time, camera, solar, lunar,
 * atmosphere, environment, source mode and confidence. The renderer consumes it; UI components
 * read it; nothing combines weather, astronomy and camera values anywhere else.
 */
import type { HorizonProfile, TerrainSunEvents } from './horizon.ts';
import type { LunarState, SolarState, DayEvents } from '@lightmap/astronomy';
import type { GeoPoint } from '@lightmap/geospatial';
import type {
  AtmosphereParameters,
  WeatherFrame,
  WeatherMode,
  WeatherScenarioId,
} from '@lightmap/weather';

export interface LocationState {
  point: GeoPoint;
  /** IANA zone. */
  timeZone: string;
  label: string;
  /** Where the label/zone came from, for the confidence panel and attribution. */
  source: 'search' | 'map-click' | 'coordinates' | 'device' | 'saved' | 'fixture';
}

export interface CameraState {
  /** Where the virtual photographer stands (may differ from the pin when orbiting). */
  eye: GeoPoint;
  /** Eye height above ground, metres. */
  eyeHeightM: number;
  /** Compass heading, degrees clockwise from north [0, 360). */
  headingDeg: number;
  /** Pitch, degrees; 0 = level, positive = up, −90 = straight down. */
  pitchDeg: number;
  /** Horizontal field of view, degrees. */
  fovDeg: number;
  /** Full-frame-equivalent focal length that produced `fovDeg`, when set from a preset. */
  focalLengthMm: number | null;
  /** 'viewpoint' = eye-level first person; 'map' = orbiting the pin from above. */
  mode: 'viewpoint' | 'map';
}

export type SourceMode = 'REAL_REFERENCE' | 'SIMULATED_LIGHTING' | 'ESTIMATED_PREVIEW';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type WeatherConfidenceLevel = ConfidenceLevel | 'SCENARIO';
export type ImageryConfidenceLevel = 'REAL_REFERENCE' | 'NONE';

export interface ConfidenceState {
  astronomy: ConfidenceLevel;
  environment: ConfidenceLevel;
  weather: WeatherConfidenceLevel;
  imagery: ImageryConfidenceLevel;
  /** Terrain and scene-detail split so the panel can say "Terrain: High, Scene detail: Medium". */
  terrain: ConfidenceLevel;
  sceneDetail: ConfidenceLevel;
  /** One-line reasons per dimension, in UI wording. */
  notes: Record<'astronomy' | 'environment' | 'weather' | 'imagery', string>;
}

export interface EnvironmentState {
  terrainAvailable: boolean;
  terrainProviderId: string;
  basemapProviderId: string;
  basemapDetail: 'coarse' | 'regional' | 'street';
  buildingsAvailable: boolean;
  /** Ground elevation at the pin when known. */
  groundElevationM: number | null;
  attributions: Array<{ id: string; attribution: string; attributionUrl?: string }>;
  /** True if any active provider is a development fixture. */
  fixtureMode: boolean;
}

export interface AtmosphereState {
  mode: WeatherMode;
  scenario: WeatherScenarioId;
  /** The frame in force when mode is a forecast; null when scenario-driven. */
  frame: WeatherFrame | null;
  parameters: AtmosphereParameters;
  /** Direct sunlight colour temperature, Kelvin, from solar elevation. */
  colorTemperatureK: number;
  /** 0 cool … 0.5 neutral … 1 warm. */
  warmth: number;
  /** User-facing line, e.g. "Forecast unavailable this far ahead — scenario: Overcast". */
  summary: string;
  providerId: string | null;
  providerAttribution: string | null;
}

export interface RenderSettings {
  /** Quality ladder rung (plan §6): 0 map overlay, 1 terrain preview, 2 imagery-based, 3 high-fidelity. */
  quality: 0 | 1 | 2 | 3;
  shadows: boolean;
  shadowMapSize: 1024 | 2048 | 4096;
  softShadows: boolean;
  /** Terrain screen-space error; higher is cheaper. */
  terrainScreenSpaceError: number;
  resolutionScale: number;
  reducedMotion: boolean;
}

/**
 * The terrain horizon around the viewpoint and what it does to today's Sun (`horizon.ts`).
 * Present only when a profile has been sampled for this location; the renderer's ellipsoid
 * fallback never produces one.
 */
export interface TerrainHorizonState {
  profile: HorizonProfile;
  /** Terrain-horizon elevation at the Sun's current bearing, degrees. */
  horizonAtSunDeg: number;
  /** Whether the Sun (upper limb, refracted) shows above the terrain right now. */
  sunAboveTerrain: boolean;
  /** Same for the Moon when included. */
  moonAboveTerrain: boolean | null;
  /** Today's first/last light over the terrain and the visible spells. */
  sunEvents: TerrainSunEvents;
}

export interface SceneState {
  location: LocationState;
  /** Wall-clock at the location. */
  localTime: { date: string; time: string; offsetMinutes: number; zoneAbbreviation: string };
  utc: Date;
  camera: CameraState;
  solar: SolarState;
  lunar: LunarState | null;
  dayEvents: DayEvents;
  atmosphere: AtmosphereState;
  environment: EnvironmentState;
  sourceMode: SourceMode;
  confidence: ConfidenceState;
  render: RenderSettings;
  /** Null until a terrain horizon has been sampled for this location. */
  terrainHorizon: TerrainHorizonState | null;
}

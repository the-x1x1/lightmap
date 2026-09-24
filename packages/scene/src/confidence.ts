/**
 * Scene confidence (plan §11): independent dimensions, no invented 0–100 number. Pure.
 */
import type { HorizonDecision } from '@lightmap/weather';
import type { ConfidenceLevel, ConfidenceState, EnvironmentState, SourceMode } from './types.ts';

export interface ConfidenceInput {
  /** False when the input is invalid (e.g. no timezone yet). */
  astronomyInputsValid: boolean;
  environment: EnvironmentState;
  weather: HorizonDecision;
  /** Whether a licensed real reference is being shown. */
  realReference: boolean;
  /** True when the weather provider failed and the app fell back to a scenario. */
  weatherProviderFailed?: boolean;
}

export function terrainConfidence(env: EnvironmentState): ConfidenceLevel {
  if (!env.terrainAvailable) return 'LOW';
  return env.terrainProviderId === 'ellipsoid' ? 'LOW' : 'HIGH';
}

export function sceneDetailConfidence(env: EnvironmentState): ConfidenceLevel {
  if (env.buildingsAvailable && env.basemapDetail === 'street') return 'HIGH';
  if (env.basemapDetail === 'street' || env.basemapDetail === 'regional') return 'MEDIUM';
  return 'LOW';
}

export function environmentConfidence(env: EnvironmentState): ConfidenceLevel {
  const t = terrainConfidence(env);
  const d = sceneDetailConfidence(env);
  if (t === 'HIGH' && d === 'HIGH') return 'HIGH';
  if (t === 'HIGH' || d !== 'LOW') return 'MEDIUM';
  return 'LOW';
}

export function deriveConfidence(input: ConfidenceInput): ConfidenceState {
  const astronomy: ConfidenceLevel = input.astronomyInputsValid ? 'HIGH' : 'LOW';
  const terrain = terrainConfidence(input.environment);
  const sceneDetail = sceneDetailConfidence(input.environment);
  const environment = environmentConfidence(input.environment);
  const weather = input.weatherProviderFailed ? 'SCENARIO' : input.weather.weatherConfidence;
  const imagery = input.realReference ? 'REAL_REFERENCE' : 'NONE';

  const envNote =
    environment === 'HIGH'
      ? 'Real terrain with detailed imagery and buildings'
      : terrain === 'HIGH'
        ? `Real terrain; ${input.environment.basemapDetail === 'coarse' ? 'coarse basemap, no buildings' : 'imagery without 3D buildings'}`
        : 'No terrain data here — flat ground assumed';
  const weatherNote = input.weatherProviderFailed
    ? 'Live forecast unavailable — showing your selected scenario'
    : input.weather.reason;

  return {
    astronomy,
    environment,
    weather,
    imagery,
    terrain,
    sceneDetail,
    notes: {
      astronomy:
        astronomy === 'HIGH'
          ? 'Sun and moon positions computed from ephemeris (±0.01° sun, ±0.3° moon)'
          : 'Waiting for a valid location and time zone',
      environment: envNote,
      weather: weatherNote,
      imagery:
        imagery === 'REAL_REFERENCE'
          ? 'A licensed photograph near this point is shown as evidence'
          : 'No licensed real photograph available — simulation only',
    },
  };
}

/** The three-level source label (plan §2). */
export function deriveSourceMode(confidence: ConfidenceState): SourceMode {
  if (confidence.imagery === 'REAL_REFERENCE') return 'REAL_REFERENCE';
  if (confidence.terrain === 'HIGH' && confidence.sceneDetail !== 'LOW')
    return 'SIMULATED_LIGHTING';
  return 'ESTIMATED_PREVIEW';
}

export const SOURCE_MODE_LABEL: Record<SourceMode, string> = {
  REAL_REFERENCE: 'Real Reference',
  SIMULATED_LIGHTING: 'Simulated Lighting',
  ESTIMATED_PREVIEW: 'Estimated Preview',
};

export const SOURCE_MODE_DESCRIPTION: Record<SourceMode, string> = {
  REAL_REFERENCE:
    'A licensed photograph exists near this point. It shows the place, not necessarily this date or time.',
  SIMULATED_LIGHTING:
    'Scene geometry is real terrain and map data; light and atmosphere are simulated for this date, time and weather state.',
  ESTIMATED_PREVIEW:
    'Imagery or geometry is incomplete here. Light direction is exact; the scene itself is an approximation.',
};

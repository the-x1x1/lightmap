/**
 * Build a SceneState from its inputs. This is the only combination point (plan §24). Pure and
 * synchronous: astronomy is computed inline (sub-millisecond), and weather frames arrive already
 * fetched so the timeline never waits on the network (plan §19).
 */
import { astronomy as defaultAstronomy, utcToWallClock, type AstronomyService, type DayEvents } from '@lightmap/astronomy';
import {
  colorTemperatureKelvin,
  decideWeatherMode,
  interpolateFrame,
  parametersForForecast,
  scenarioById,
  scenarioForConditions,
  warmthFromKelvin,
  type WeatherCapabilities,
  type WeatherFrame,
  type WeatherScenarioId,
} from '@lightmap/weather';
import { deriveConfidence, deriveSourceMode } from './confidence.ts';
import type { AtmosphereState, CameraState, EnvironmentState, LocationState, RenderSettings, SceneState } from './types.ts';

export interface SceneInputs {
  location: LocationState;
  utc: Date;
  /** "Now" for the forecast-horizon decision (injected for tests). */
  now: Date;
  camera: CameraState;
  environment: EnvironmentState;
  /** User-chosen scenario; used when the mode is SCENARIO or the user is comparing. */
  scenario: WeatherScenarioId;
  /** When true the user has pinned a scenario even inside the forecast window ("compare alternate scenarios"). */
  forceScenario: boolean;
  weather: {
    capabilities: WeatherCapabilities | null;
    frames: readonly WeatherFrame[];
    providerFailed: boolean;
  };
  render: RenderSettings;
  includeLunar: boolean;
  realReference: boolean;
  /** Cached day events for this civil date, to avoid recomputing on every scrub tick. */
  dayEvents?: DayEvents;
  astronomyService?: AstronomyService;
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  quality: 1,
  shadows: true,
  shadowMapSize: 2048,
  softShadows: true,
  terrainScreenSpaceError: 2,
  resolutionScale: 1,
  reducedMotion: false,
};

export function buildSceneState(inputs: SceneInputs): SceneState {
  const svc = inputs.astronomyService ?? defaultAstronomy;
  const { location, utc } = inputs;
  const solarInput = { latitude: location.point.latitude, longitude: location.point.longitude, timestampUtc: utc, timeZone: location.timeZone };
  const solar = svc.getSolarState(solarInput);
  const lunar = inputs.includeLunar ? svc.getLunarState(solarInput) : null;
  const wall = utcToWallClock(utc, location.timeZone);
  const dayEvents =
    inputs.dayEvents && inputs.dayEvents.timeZone === location.timeZone && inputs.dayEvents.date === dateOf(wall)
      ? inputs.dayEvents
      : svc.getDayEvents({ latitude: location.point.latitude, longitude: location.point.longitude, timeZone: location.timeZone, date: wall });

  const atmosphere = deriveAtmosphere(inputs, solar.elevationDegrees);
  const horizon = decideWeatherMode(utc, inputs.now, inputs.weather.capabilities);
  const confidence = deriveConfidence({
    astronomyInputsValid: Number.isFinite(solar.elevationDegrees) && location.timeZone.length > 0,
    environment: inputs.environment,
    weather: horizon,
    realReference: inputs.realReference,
    weatherProviderFailed: inputs.weather.providerFailed,
  });
  // When the user pins a scenario inside the forecast window, the weather dimension is a scenario.
  if (atmosphere.mode === 'SCENARIO' && confidence.weather !== 'SCENARIO') {
    confidence.weather = 'SCENARIO';
    confidence.notes.weather = 'You are comparing a scenario instead of the forecast';
  }

  return {
    location,
    localTime: { date: dateOf(wall), time: `${pad(wall.hour)}:${pad(wall.minute)}`, offsetMinutes: wall.offsetMinutes, zoneAbbreviation: wall.zoneAbbreviation },
    utc,
    camera: inputs.camera,
    solar,
    lunar,
    dayEvents,
    atmosphere,
    environment: inputs.environment,
    sourceMode: deriveSourceMode(confidence),
    confidence,
    render: inputs.render,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function dateOf(w: { year: number; month: number; day: number }): string {
  return `${w.year.toString().padStart(4, '0')}-${pad(w.month)}-${pad(w.day)}`;
}

export function deriveAtmosphere(inputs: Pick<SceneInputs, 'utc' | 'now' | 'scenario' | 'forceScenario' | 'weather'>, solarElevationDeg: number): AtmosphereState {
  const caps = inputs.weather.capabilities;
  const decision = decideWeatherMode(inputs.utc, inputs.now, caps);
  const kelvin = colorTemperatureKelvin(solarElevationDeg);
  const warmth = warmthFromKelvin(kelvin);
  const frame = decision.fetchWorthwhile && !inputs.weather.providerFailed ? interpolateFrame(inputs.weather.frames, inputs.utc) : null;
  const useForecast = frame !== null && !inputs.forceScenario && (decision.mode === 'FORECAST' || decision.mode === 'EXTENDED_FORECAST' || decision.mode === 'RECENT_PAST');

  if (useForecast) {
    const scenario = scenarioForConditions(frame.cloudCoverTotal, frame);
    const label = decision.mode === 'EXTENDED_FORECAST' ? 'Extended forecast (low confidence)' : decision.mode === 'RECENT_PAST' ? 'Recent conditions' : 'Forecast';
    return {
      mode: decision.mode,
      scenario,
      frame,
      parameters: parametersForForecast(frame),
      colorTemperatureK: kelvin,
      warmth,
      summary: `${label}: ${Math.round(frame.cloudCoverTotal)} % cloud · ${scenarioById(scenario).label}`,
      providerId: caps?.providerId ?? null,
      providerAttribution: caps?.attribution ?? null,
    };
  }

  const s = scenarioById(inputs.scenario);
  const why = inputs.weather.providerFailed
    ? 'Live forecast unavailable'
    : inputs.forceScenario && decision.fetchWorthwhile
      ? 'Comparing scenario'
      : decision.mode === 'PAST'
        ? 'Historical weather not loaded'
        : decision.mode === 'SCENARIO' && caps
          ? 'Forecast unavailable this far ahead'
          : 'No forecast';
  return {
    mode: 'SCENARIO',
    scenario: s.id,
    frame: null,
    parameters: s.parameters,
    colorTemperatureK: kelvin,
    warmth,
    summary: `${why} — scenario: ${s.label}`,
    providerId: null,
    providerAttribution: null,
  };
}

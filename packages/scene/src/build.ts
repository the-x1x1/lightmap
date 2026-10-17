/**
 * Build a SceneState from its inputs. This is the only combination point (plan §24). Pure and
 * synchronous: astronomy is computed inline (sub-millisecond), and weather frames arrive already
 * fetched so the timeline never waits on the network (plan §19).
 */
import {
  astronomy as defaultAstronomy,
  galacticCentrePosition,
  milkyWayCoreFrom,
  moonPosition,
  utcToWallClock,
  type AstronomyService,
  type DayEvents,
} from '@lightmap/astronomy';
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
import {
  MOON_SEMIDIAMETER_DEG,
  aboveTerrain,
  horizonElevationAt,
  terrainSunEvents,
  type HorizonProfile,
  type TerrainSunEvents,
} from './horizon.ts';
import type {
  AtmosphereState,
  CameraState,
  EnvironmentState,
  LocationState,
  RenderSettings,
  SceneState,
  TerrainHorizonState,
} from './types.ts';

export interface SceneInputs {
  location: LocationState;
  /** Zone for the clock and day events; the place's own when omitted (plan §17 time-zone mode). */
  timeZone?: string;
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
  /** Terrain horizon sampled around this location (null/undefined: none yet). */
  horizonProfile?: HorizonProfile | null;
}

// Terrain sun events per (profile, civil day): the scan is ~300 solar positions, so it is memoised
// per profile rather than repeated on every scrub tick.
const terrainEventCache = new WeakMap<
  HorizonProfile,
  Map<string, { sun: TerrainSunEvents; moon: TerrainSunEvents | null }>
>();

function terrainHorizonState(
  profile: HorizonProfile,
  svc: AstronomyService,
  inputs: Pick<SceneInputs, 'location'>,
  solar: SceneState['solar'],
  lunar: SceneState['lunar'],
  dayEvents: DayEvents,
): TerrainHorizonState {
  const { location } = inputs;
  const key = `${dayEvents.date}|${dayEvents.timeZone}|${location.point.latitude}|${location.point.longitude}`;
  let perDay = terrainEventCache.get(profile);
  if (!perDay) {
    perDay = new Map();
    terrainEventCache.set(profile, perDay);
  }
  let events = perDay.get(key);
  if (!events || (lunar && !events.moon)) {
    const sunEvents =
      events?.sun ??
      terrainSunEvents(
        profile,
        (t) => {
          const s = svc.getSolarState({
            latitude: location.point.latitude,
            longitude: location.point.longitude,
            timestampUtc: t,
            timeZone: location.timeZone,
          });
          return { azimuthDeg: s.azimuthDegrees, elevationDeg: s.elevationDegrees };
        },
        {
          dayStart: dayEvents.dayStart,
          dayEnd: dayEvents.dayEnd,
          sunrise: dayEvents.sunrise,
          sunset: dayEvents.sunset,
        },
      );
    // The Moon's crossings the same way (with the lunar state, i.e. moon planning): "when does
    // the Moon clear the ridge?" — its own rise/set as the flat-horizon comparison.
    const moonEvents = lunar
      ? terrainSunEvents(
          profile,
          (t) => {
            const m = moonPosition(t, location.point.latitude, location.point.longitude);
            return { azimuthDeg: m.azimuthDeg, elevationDeg: m.topocentricElevationDeg };
          },
          {
            dayStart: dayEvents.dayStart,
            dayEnd: dayEvents.dayEnd,
            sunrise: lunar.moonrise,
            sunset: lunar.moonset,
          },
          5,
          MOON_SEMIDIAMETER_DEG,
        )
      : null;
    if (perDay.size > 8) perDay.clear();
    events = { sun: sunEvents, moon: moonEvents };
    perDay.set(key, events);
  }
  return {
    profile,
    horizonAtSunDeg: horizonElevationAt(profile, solar.azimuthDegrees),
    sunAboveTerrain: aboveTerrain(profile, solar.azimuthDegrees, solar.elevationDegrees),
    moonAboveTerrain: lunar
      ? aboveTerrain(profile, lunar.azimuthDegrees, lunar.elevationDegrees, MOON_SEMIDIAMETER_DEG)
      : null,
    sunEvents: events.sun,
    moonEvents: lunar ? events.moon : null,
  };
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
  const timeZone = inputs.timeZone ?? location.timeZone;
  const solarInput = {
    latitude: location.point.latitude,
    longitude: location.point.longitude,
    timestampUtc: utc,
    timeZone,
  };
  const solar = svc.getSolarState(solarInput);
  const lunar = inputs.includeLunar ? svc.getLunarState(solarInput) : null;
  // Night planning rides with the lunar state: the Milky Way core and whether the sky is dark.
  const nightSky = lunar
    ? milkyWayCoreFrom(
        galacticCentrePosition(utc, location.point.latitude, location.point.longitude),
        solar.elevationDegrees,
        lunar.isAboveHorizon,
        lunar.illuminatedFraction,
      )
    : null;
  const wall = utcToWallClock(utc, timeZone);
  const dayEvents =
    inputs.dayEvents &&
    inputs.dayEvents.timeZone === timeZone &&
    inputs.dayEvents.date === dateOf(wall)
      ? inputs.dayEvents
      : svc.getDayEvents({
          latitude: location.point.latitude,
          longitude: location.point.longitude,
          timeZone,
          date: wall,
        });

  const atmosphere = deriveAtmosphere(inputs, solar.elevationDegrees);
  const horizon = decideWeatherMode(utc, inputs.now, inputs.weather.capabilities);
  const confidence = deriveConfidence({
    astronomyInputsValid: Number.isFinite(solar.elevationDegrees) && location.timeZone.length > 0,
    environment: inputs.environment,
    weather: horizon,
    realReference: inputs.realReference,
    weatherProviderFailed: inputs.weather.providerFailed,
    groundPainted: inputs.render.groundTexture !== false && inputs.render.shadows,
  });
  // When the user pins a scenario inside the forecast window, the weather dimension is a scenario.
  if (atmosphere.mode === 'SCENARIO' && confidence.weather !== 'SCENARIO') {
    confidence.weather = 'SCENARIO';
    confidence.notes.weather = 'You are comparing a scenario instead of the forecast';
  }

  return {
    location,
    timeZone,
    localTime: {
      date: dateOf(wall),
      time: `${pad(wall.hour)}:${pad(wall.minute)}`,
      offsetMinutes: wall.offsetMinutes,
      zoneAbbreviation: wall.zoneAbbreviation,
    },
    utc,
    camera: inputs.camera,
    solar,
    lunar,
    nightSky,
    dayEvents,
    atmosphere,
    environment: inputs.environment,
    sourceMode: deriveSourceMode(confidence),
    confidence,
    render: inputs.render,
    terrainHorizon: inputs.horizonProfile
      ? terrainHorizonState(inputs.horizonProfile, svc, inputs, solar, lunar, dayEvents)
      : null,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function dateOf(w: { year: number; month: number; day: number }): string {
  return `${w.year.toString().padStart(4, '0')}-${pad(w.month)}-${pad(w.day)}`;
}

export function deriveAtmosphere(
  inputs: Pick<SceneInputs, 'utc' | 'now' | 'scenario' | 'forceScenario' | 'weather'>,
  solarElevationDeg: number,
): AtmosphereState {
  const caps = inputs.weather.capabilities;
  const decision = decideWeatherMode(inputs.utc, inputs.now, caps);
  const kelvin = colorTemperatureKelvin(solarElevationDeg);
  const warmth = warmthFromKelvin(kelvin);
  const frame =
    decision.fetchWorthwhile && !inputs.weather.providerFailed
      ? interpolateFrame(inputs.weather.frames, inputs.utc)
      : null;
  const useForecast =
    frame !== null &&
    !inputs.forceScenario &&
    (decision.mode === 'FORECAST' ||
      decision.mode === 'EXTENDED_FORECAST' ||
      decision.mode === 'RECENT_PAST');

  if (useForecast) {
    const scenario = scenarioForConditions(frame.cloudCoverTotal, frame);
    const label =
      decision.mode === 'EXTENDED_FORECAST'
        ? 'Extended forecast (low confidence)'
        : decision.mode === 'RECENT_PAST'
          ? decision.weatherConfidence === 'MEDIUM'
            ? 'Observed (reanalysis)'
            : 'Recent conditions'
          : 'Forecast';
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
        : decision.mode === 'RECENT_PAST'
          ? 'Observed conditions not loaded'
          : decision.mode === 'SCENARIO' && caps
            ? 'Forecast unavailable this far ahead'
            : decision.fetchWorthwhile && inputs.weather.frames.length === 0
              ? // Inside the forecast's reach with nothing back yet: it is on its way.
                'Forecast loading'
              : decision.fetchWorthwhile
                ? 'No forecast for this hour'
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

import { describe, expect, it } from 'vitest';
import { localSelectionToUtc } from '@lightmap/astronomy';
import {
  FIXTURE_CAPABILITIES,
  FixtureWeatherProvider,
  OPEN_METEO_CAPABILITIES,
} from '@lightmap/weather';
import { DEFAULT_RENDER_SETTINGS, buildSceneState, type SceneInputs } from '../src/build.ts';
import { deriveConfidence, deriveSourceMode } from '../src/confidence.ts';
import {
  defaultCamera,
  focalLengthForFov,
  frameCoordinates,
  horizontalFovDeg,
  isInFrame,
  lightingGeometry,
  relativeBearing,
} from '../src/camera.ts';
import { explainScene } from '../src/explain.ts';
import type { EnvironmentState } from '../src/types.ts';

const kailua = {
  point: { latitude: 21.397, longitude: -157.727 },
  timeZone: 'Pacific/Honolulu',
  label: 'Kailua Beach',
  source: 'search' as const,
};
const envGood: EnvironmentState = {
  terrainAvailable: true,
  terrainProviderId: 'reearth-mapterhorn-terrain',
  basemapProviderId: 'xyz-imagery',
  basemapDetail: 'street',
  buildingsAvailable: false,
  groundElevationM: 2,
  attributions: [],
  fixtureMode: false,
};
const envCoarse: EnvironmentState = {
  ...envGood,
  basemapProviderId: 'natural-earth-ii',
  basemapDetail: 'coarse',
};
const envFlat: EnvironmentState = {
  ...envCoarse,
  terrainAvailable: false,
  terrainProviderId: 'ellipsoid',
};

function inputs(over: Partial<SceneInputs> = {}): SceneInputs {
  return {
    location: kailua,
    utc: localSelectionToUtc({ year: 2026, month: 5, day: 31 }, 12 * 60 + 30, kailua.timeZone),
    now: new Date('2026-05-01T00:00:00Z'),
    camera: defaultCamera(kailua.point, 90),
    environment: envGood,
    scenario: 'partly-cloudy',
    forceScenario: false,
    weather: { capabilities: OPEN_METEO_CAPABILITIES, frames: [], providerFailed: false },
    render: DEFAULT_RENDER_SETTINGS,
    includeLunar: true,
    realReference: false,
    ...over,
  };
}

describe('buildSceneState — Kailua Beach, 31 May 2026, 12:30 (acceptance case)', () => {
  it('combines time, solar and weather correctly', () => {
    const s = buildSceneState(inputs());
    expect(s.localTime).toMatchObject({
      date: '2026-05-31',
      time: '12:30',
      offsetMinutes: -600,
      zoneAbbreviation: 'HST',
    });
    expect(s.solar.elevationDegrees).toBeGreaterThan(89);
    expect(s.dayEvents.sunrise).not.toBeNull();
    expect(s.atmosphere.mode).toBe('SCENARIO'); // 30 days ahead: outside the 16-day horizon
    expect(s.atmosphere.summary).toContain('unavailable this far ahead');
    expect(s.atmosphere.scenario).toBe('partly-cloudy');
    expect(s.confidence.weather).toBe('SCENARIO');
    expect(s.confidence.astronomy).toBe('HIGH');
    expect(s.sourceMode).toBe('SIMULATED_LIGHTING');
    expect(s.lunar?.phaseName).toBe('Full Moon');
  });

  it('uses the forecast frame inside the horizon and labels it a forecast', async () => {
    const now = new Date('2026-05-30T00:00:00Z');
    const series = await new FixtureWeatherProvider({ pattern: 'overcast' }).getForecast(
      21.397,
      -157.727,
      new Date('2026-05-31T00:00:00Z'),
      new Date('2026-06-01T00:00:00Z'),
    );
    const s = buildSceneState(
      inputs({
        now,
        weather: {
          capabilities: FIXTURE_CAPABILITIES,
          frames: series.frames,
          providerFailed: false,
        },
      }),
    );
    expect(s.atmosphere.mode).toBe('FORECAST');
    expect(s.atmosphere.scenario).toBe('overcast');
    expect(s.atmosphere.frame?.cloudCoverTotal).toBe(95);
    expect(s.atmosphere.parameters.sunTransmittance).toBeLessThan(0.3);
    expect(s.confidence.weather).toBe('HIGH'); // 46 h ahead is inside the 48 h HIGH window
  });

  it('lets the user pin a scenario inside the forecast window and says so', async () => {
    const now = new Date('2026-05-30T00:00:00Z');
    const series = await new FixtureWeatherProvider({ pattern: 'overcast' }).getForecast(
      21.397,
      -157.727,
      new Date('2026-05-31T00:00:00Z'),
      new Date('2026-06-01T00:00:00Z'),
    );
    const s = buildSceneState(
      inputs({
        now,
        scenario: 'clear',
        forceScenario: true,
        weather: {
          capabilities: FIXTURE_CAPABILITIES,
          frames: series.frames,
          providerFailed: false,
        },
      }),
    );
    expect(s.atmosphere.mode).toBe('SCENARIO');
    expect(s.atmosphere.scenario).toBe('clear');
    expect(s.atmosphere.summary).toContain('Comparing scenario');
    expect(s.confidence.weather).toBe('SCENARIO');
  });

  it('falls back to the scenario when the provider fails, without pretending', () => {
    const s = buildSceneState(
      inputs({
        now: new Date('2026-05-30T00:00:00Z'),
        weather: { capabilities: OPEN_METEO_CAPABILITIES, frames: [], providerFailed: true },
      }),
    );
    expect(s.atmosphere.mode).toBe('SCENARIO');
    expect(s.atmosphere.summary).toContain('Live forecast unavailable');
    expect(s.confidence.notes.weather).toContain('unavailable');
  });

  it('scenario changes visibly change the parameters', () => {
    const clear = buildSceneState(inputs({ scenario: 'clear' })).atmosphere.parameters;
    const overcast = buildSceneState(inputs({ scenario: 'overcast' })).atmosphere.parameters;
    expect(clear.sunTransmittance - overcast.sunTransmittance).toBeGreaterThan(0.5);
    expect(overcast.cloudOpacity - clear.cloudOpacity).toBeGreaterThan(0.5);
  });

  it('scrubbing the clock changes solar state and colour temperature continuously', () => {
    const times = [6, 9, 12.5, 16, 18.5, 19.5, 21].map((h) =>
      localSelectionToUtc({ year: 2026, month: 5, day: 31 }, h * 60, kailua.timeZone),
    );
    const states = times.map((utc) => buildSceneState(inputs({ utc })));
    const elev = states.map((s) => s.solar.elevationDegrees);
    expect(elev[0]).toBeGreaterThan(0); // 06:00 just after sunrise (05:48)
    expect(elev[2]).toBeGreaterThan(elev[1]!);
    expect(elev[4]).toBeGreaterThan(elev[5]!); // sunset 19:09
    expect(states[5]!.solar.phase).toBe('blue-hour'); // 19:30 → −4…−6°? sunset 19:09 ⇒ 19:30 ≈ −4.6°
    expect(['nautical-twilight', 'astronomical-twilight', 'night']).toContain(
      states[6]!.solar.phase,
    ); // 21:00: sun ≈ −25°
    expect(states[4]!.atmosphere.colorTemperatureK).toBeLessThan(
      states[2]!.atmosphere.colorTemperatureK,
    ); // warmer late afternoon
    expect(states[5]!.atmosphere.warmth).toBeLessThan(0.5); // blue hour is cool
  });

  it('reuses cached day events for the same date and recomputes across midnight', () => {
    const a = buildSceneState(inputs());
    const b = buildSceneState(
      inputs({ dayEvents: a.dayEvents, utc: new Date(a.utc.getTime() + 3_600_000) }),
    );
    expect(b.dayEvents).toBe(a.dayEvents);
    const c = buildSceneState(
      inputs({ dayEvents: a.dayEvents, utc: new Date(a.utc.getTime() + 24 * 3_600_000) }),
    );
    expect(c.dayEvents).not.toBe(a.dayEvents);
    expect(c.dayEvents.date).toBe('2026-06-01');
  });
});

describe('confidence and source mode', () => {
  const horizon = {
    mode: 'SCENARIO' as const,
    leadHours: 700,
    reason: 'far',
    fetchWorthwhile: false,
    weatherConfidence: 'SCENARIO' as const,
  };
  it('grades environment by terrain and detail', () => {
    expect(
      deriveConfidence({
        astronomyInputsValid: true,
        environment: envGood,
        weather: horizon,
        realReference: false,
      }).environment,
    ).toBe('MEDIUM');
    expect(
      deriveConfidence({
        astronomyInputsValid: true,
        environment: { ...envGood, buildingsAvailable: true },
        weather: horizon,
        realReference: false,
      }).environment,
    ).toBe('HIGH');
    expect(
      deriveConfidence({
        astronomyInputsValid: true,
        environment: envCoarse,
        weather: horizon,
        realReference: false,
      }).environment,
    ).toBe('MEDIUM');
    expect(
      deriveConfidence({
        astronomyInputsValid: true,
        environment: envFlat,
        weather: horizon,
        realReference: false,
      }).environment,
    ).toBe('LOW');
  });
  it('maps to the three source labels', () => {
    expect(
      deriveSourceMode(
        deriveConfidence({
          astronomyInputsValid: true,
          environment: envGood,
          weather: horizon,
          realReference: false,
        }),
      ),
    ).toBe('SIMULATED_LIGHTING');
    expect(
      deriveSourceMode(
        deriveConfidence({
          astronomyInputsValid: true,
          environment: envCoarse,
          weather: horizon,
          realReference: false,
        }),
      ),
    ).toBe('ESTIMATED_PREVIEW');
    expect(
      deriveSourceMode(
        deriveConfidence({
          astronomyInputsValid: true,
          environment: envFlat,
          weather: horizon,
          realReference: true,
        }),
      ),
    ).toBe('REAL_REFERENCE');
  });
  it('astronomy confidence drops only with invalid inputs', () => {
    expect(
      deriveConfidence({
        astronomyInputsValid: false,
        environment: envGood,
        weather: horizon,
        realReference: false,
      }).astronomy,
    ).toBe('LOW');
  });
});

describe('camera model', () => {
  it('derives field of view from full-frame focal length', () => {
    expect(horizontalFovDeg(24)).toBeCloseTo(73.74, 1);
    expect(horizontalFovDeg(50)).toBeCloseTo(39.6, 1);
    expect(horizontalFovDeg(135)).toBeCloseTo(15.19, 1);
    expect(focalLengthForFov(horizontalFovDeg(85))).toBeCloseTo(85, 6);
  });
  it('computes relative bearings and in-frame tests', () => {
    expect(relativeBearing(350, 10)).toBe(20);
    expect(relativeBearing(10, 350)).toBe(-20);
    expect(isInFrame({ headingDeg: 90, fovDeg: 74 }, 120)).toBe(true);
    expect(isInFrame({ headingDeg: 90, fovDeg: 74 }, 130)).toBe(false);
  });
  it('projects the sun into frame coordinates', () => {
    const c = { headingDeg: 270, pitchDeg: 0, fovDeg: 60 };
    const centre = frameCoordinates(c, 270, 0)!;
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.y).toBeCloseTo(0, 6);
    const right = frameCoordinates(c, 300, 0)!; // 30° right = frame edge
    expect(right.x).toBeCloseTo(1, 6);
    const up = frameCoordinates(c, 270, 20)!;
    expect(up.y).toBeGreaterThan(0);
    expect(frameCoordinates(c, 90, 10)).toBeNull(); // behind the camera
    const tilted = frameCoordinates({ ...c, pitchDeg: 20 }, 270, 20)!;
    expect(tilted.y).toBeCloseTo(0, 6);
  });
  it('names lighting geometry the way photographers do', () => {
    expect(lightingGeometry({ headingDeg: 270 }, 270, 10)).toBe('back-lit');
    expect(lightingGeometry({ headingDeg: 90 }, 270, 10)).toBe('front-lit');
    expect(lightingGeometry({ headingDeg: 0 }, 270, 10)).toBe('side-lit');
    expect(lightingGeometry({ headingDeg: 0 }, 180, 80)).toBe('top-lit');
    expect(lightingGeometry({ headingDeg: 0 }, 180, -5)).toBe('below-horizon');
  });
});

describe('explanation', () => {
  it('lists the plan\'s "why does it look like this" facts', () => {
    const lines = explainScene(buildSceneState(inputs({ scenario: 'partly-cloudy' })));
    const labels = lines.map((l) => l.label);
    expect(labels).toContain('Sun');
    expect(labels).toContain('Light direction');
    expect(labels).toContain('Weather scenario');
    expect(lines.find((l) => l.label === 'Weather scenario')?.value).toContain('not a forecast');
    expect(lines.find((l) => l.label === 'Confidence')?.value).toContain('scenario-only');
    expect(lines.find((l) => l.label === 'Scene source')?.value).toContain('Simulated Lighting');
  });
});

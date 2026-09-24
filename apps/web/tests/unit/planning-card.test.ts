import { describe, expect, it } from 'vitest';
import { localSelectionToUtc } from '@lightmap/astronomy';
import { OPEN_METEO_CAPABILITIES, type WeatherFrame } from '@lightmap/weather';
import {
  DEFAULT_RENDER_SETTINGS,
  buildSceneState,
  defaultCamera,
  type EnvironmentState,
  type SceneInputs,
} from '@lightmap/scene';
import { buildPlanningCard } from '@/features/export/planning-card';

const kailua = {
  point: { latitude: 21.397, longitude: -157.727 },
  timeZone: 'Pacific/Honolulu',
  label: 'Kailua Beach',
  source: 'search' as const,
};
const env: EnvironmentState = {
  terrainAvailable: true,
  terrainProviderId: 'reearth-mapterhorn-terrain',
  basemapProviderId: 'natural-earth-ii',
  basemapDetail: 'coarse',
  buildingsAvailable: false,
  groundElevationM: 2,
  attributions: [{ id: 'natural-earth-ii', attribution: 'Natural Earth II (public domain)' }],
  fixtureMode: false,
};

function scene(over: Partial<SceneInputs> = {}) {
  const inputs: SceneInputs = {
    location: kailua,
    utc: localSelectionToUtc({ year: 2026, month: 5, day: 31 }, 12 * 60 + 30, kailua.timeZone),
    now: new Date('2026-05-01T00:00:00Z'),
    camera: { ...defaultCamera(kailua.point, 270), mode: 'viewpoint', pitchDeg: 5 },
    environment: env,
    scenario: 'overcast',
    forceScenario: false,
    weather: { capabilities: OPEN_METEO_CAPABILITIES, frames: [], providerFailed: false },
    render: DEFAULT_RENDER_SETTINGS,
    includeLunar: true,
    realReference: false,
    ...over,
  };
  return buildSceneState(inputs);
}

describe('buildPlanningCard', () => {
  const generatedAt = new Date('2026-05-01T10:00:00Z');

  it('carries the honesty labels: source, scenario-not-forecast, confidence, attribution', () => {
    const card = buildPlanningCard(scene(), { generatedAt, appUrl: 'https://app.example' });
    expect(card.title).toBe('Kailua Beach');
    expect(card.sourceMode).toBe('ESTIMATED_PREVIEW'); // coarse basemap
    expect(card.sourceLabel).toBe('ESTIMATED PREVIEW');
    expect(card.weatherLine).toMatch(/^Scenario \(not a forecast\): Overcast/);
    expect(card.notes.some((n) => n.includes('No forecast exists this far ahead'))).toBe(true);
    expect(card.confidence.map((c) => c.label)).toEqual([
      'Astronomy',
      'Terrain',
      'Scene detail',
      'Weather',
      'Real reference',
    ]);
    expect(card.confidence.find((c) => c.label === 'Weather')?.level).toBe('SCENARIO');
    expect(card.attribution[0]).toBe('Natural Earth II (public domain)');
    expect(card.attribution.at(-1)).toContain('https://app.example');
    expect(card.attribution.at(-1)).toContain('2026-05-01 10:00 UTC');
  });

  it('states the solar facts that the acceptance case expects', () => {
    const card = buildPlanningCard(scene(), { generatedAt });
    expect(card.dateLine).toBe('Sun 31 May 2026 · 12:30 HST');
    const sun = card.facts.find((f) => f.label === 'Sun')!.value;
    expect(sun).toMatch(/^89\.\d° up/);
    const rs = card.facts.find((f) => f.label === 'Sunrise / sunset')!.value;
    expect(rs).toBe('05:48 / 19:09');
    const cam = card.facts.find((f) => f.label === 'Camera')!.value;
    expect(cam).toContain('Viewpoint · 270° W · pitch 5° · 24 mm');
    expect(card.facts.some((f) => f.label === 'Moon')).toBe(true);
    expect(card.fileName).toBe('lightmap-kailua-beach-2026-05-31-1230.png');
  });

  it('labels a forecast as a forecast and names the provider and confidence', () => {
    const utc = localSelectionToUtc({ year: 2026, month: 5, day: 2 }, 15 * 60, kailua.timeZone);
    const frame: WeatherFrame = {
      timestamp: utc.toISOString(),
      cloudCoverTotal: 30,
      cloudCoverLow: 10,
      cloudCoverMid: 10,
      cloudCoverHigh: 10,
      precipitationProbability: 5,
      precipitationAmount: 0,
      humidity: 60,
      visibility: 20_000,
      windSpeed: 4,
      windDirection: 60,
      weatherCode: 1,
    };
    const card = buildPlanningCard(
      scene({
        utc,
        weather: { capabilities: OPEN_METEO_CAPABILITIES, frames: [frame], providerFailed: false },
      }),
      { generatedAt },
    );
    expect(card.weatherLine).toMatch(/^Forecast \(open-meteo\)/);
    expect(card.weatherLine).toMatch(/confidence (HIGH|MEDIUM|LOW)/);
    expect(card.notes.some((n) => n.includes('No forecast exists'))).toBe(false);
  });

  it('mentions fixture data when a fixture provider was active', () => {
    const card = buildPlanningCard(scene({ environment: { ...env, fixtureMode: true } }), {
      generatedAt,
    });
    expect(card.notes.some((n) => n.includes('fixture'))).toBe(true);
  });
});

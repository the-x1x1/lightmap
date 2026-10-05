import { describe, expect, it } from 'vitest';
import { localSelectionToUtc } from '@lightmap/astronomy';
import { OPEN_METEO_CAPABILITIES, type WeatherFrame } from '@lightmap/weather';
import {
  DEFAULT_RENDER_SETTINGS,
  buildSceneState,
  defaultCamera,
  horizonProfileFromSamples,
  horizonRingDistances,
  horizonSamplePoints,
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
    // The next dark-sky nights from 31 May: the full Moon rules the first nights out.
    expect(card.facts.find((f) => f.label === 'Dark windows')!.value).toMatch(
      /^3 Jun 21:\d\d–22:\d\d \(core to 2\d°\) · 4 Jun 21:\d\d–22:\d\d \(core to 2\d°\) · \d+ more in 45 nights$/,
    );
    expect(card.facts.find((f) => f.label === 'Across the year')!.value).toBe(
      'Sunrise 64°–115° (ENE–ESE), sunset 245°–296° (WSW–WNW), noon 45°–88°',
    );
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
    // The frame's field conditions: a moderate breeze and dry air, nothing to warn about.
    expect(card.facts.find((f) => f.label === 'In the field')?.value).toBe(
      'wind 4 m/s from the ENE · humidity 60 % · visibility 20 km',
    );
    expect(card.notes.some((n) => n.startsWith('Wind:') || n.startsWith('Humidity:'))).toBe(false);
    // A fresh breeze and saturated night air put both notes on the card, in the chosen units.
    const night = localSelectionToUtc({ year: 2026, month: 5, day: 2 }, 23 * 60, kailua.timeZone);
    const windy = buildPlanningCard(
      scene({
        utc: night,
        weather: {
          capabilities: OPEN_METEO_CAPABILITIES,
          frames: [{ ...frame, timestamp: night.toISOString(), windSpeed: 9, humidity: 97 }],
          providerFailed: false,
        },
      }),
      { generatedAt, units: 'imperial' },
    );
    expect(windy.facts.find((f) => f.label === 'In the field')?.value).toBe(
      'wind 20 mph from the ENE · humidity 97 % · visibility 12 mi',
    );
    expect(windy.notes).toContain(
      'Wind: fresh — weigh the tripod down; clouds streak in a long exposure.',
    );
    expect(windy.notes).toContain(
      'Humidity: near saturation — dew on the glass is likely; a lens warmer or a deep hood helps.',
    );
  });

  it('mentions fixture data when a fixture provider was active', () => {
    const card = buildPlanningCard(scene({ environment: { ...env, fixtureMode: true } }), {
      generatedAt,
    });
    expect(card.notes.some((n) => n.includes('fixture'))).toBe(true);
  });
});

describe('planning card — terrain horizon', () => {
  it('prints first/last light over the terrain and the behind-terrain state, with the caveat', () => {
    const ring = horizonRingDistances().reduce((b, d) =>
      Math.abs(d - 2000) < Math.abs(b - 2000) ? d : b,
    );
    const samples = horizonSamplePoints(kailua.point).map((p) => ({
      azimuthDeg: p.azimuthDeg,
      distanceM: p.distanceM,
      heightM: p.azimuthDeg >= 30 && p.azimuthDeg <= 150 && p.distanceM === ring ? 600 : 0,
    }));
    const horizonProfile = horizonProfileFromSamples(kailua.point, 2, 1.6, samples, {
      providerId: 'test-dem',
      resolutionM: 30,
    });
    const dawn = scene({
      horizonProfile,
      utc: localSelectionToUtc({ year: 2026, month: 5, day: 31 }, 6 * 60, kailua.timeZone),
    });
    const card = buildPlanningCard(dawn, { generatedAt: new Date('2026-05-01T00:00:00Z') });
    const over = card.facts.find((f) => f.label === 'Over the terrain');
    expect(over).toBeDefined();
    expect(over!.value).toMatch(/first light \d\d:\d\d · last light \d\d:\d\d/);
    expect(over!.value).toContain('trees and buildings not modelled');
    const now = card.facts.find((f) => f.label === 'Right now');
    expect(now?.value).toContain('sun behind the terrain');
    // No profile: none of these rows exist.
    const plain = buildPlanningCard(scene(), { generatedAt: new Date('2026-05-01T00:00:00Z') });
    expect(plain.facts.some((f) => f.label === 'Over the terrain')).toBe(false);
  });
});

describe('planning card — depth of field', () => {
  it('prints the real lens, aperture, focus and the sharp range when the camera options are given', () => {
    const sc = scene();
    const model = buildPlanningCard(sc, {
      generatedAt: new Date('2026-05-30T20:00:00Z'),
      camera: { sensorWidthMm: 36, sensorHeightMm: 24, aperture: 8, focusDistanceM: 5 },
    });
    const row = model.facts.find((f) => f.label === 'Depth of field');
    expect(row).toBeDefined();
    // The default 24 mm at f/8 focused at 5 m reaches infinity (hyperfocal ≈ 2.5 m).
    expect(row!.value).toMatch(/^24 mm f\/8 at 5\.0 m: sharp 1\.\d m–∞$/);
    // Wide open the far limit is finite and the hyperfocal distance is offered.
    const wide = buildPlanningCard(sc, {
      generatedAt: new Date('2026-05-30T20:00:00Z'),
      camera: { sensorWidthMm: 36, sensorHeightMm: 24, aperture: 2.8, focusDistanceM: 5 },
    }).facts.find((f) => f.label === 'Depth of field')!;
    expect(wide.value).toMatch(/sharp \d\.\d m–\d+ m · hyperfocal \d\.\d m$/);
    // Without camera options the card stays as before.
    const plain = buildPlanningCard(sc, { generatedAt: new Date('2026-05-30T20:00:00Z') });
    expect(plain.facts.some((f) => f.label === 'Depth of field')).toBe(false);
  });
});

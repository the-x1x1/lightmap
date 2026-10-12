import { describe, expect, it } from 'vitest';
import { buildShotList, shotBlock } from '../../features/export/shot-list.ts';
import type { ProjectDto, ViewpointDto } from '../../lib/api-types.ts';

const project: ProjectDto = {
  id: 'p1',
  name: 'Kailua weekend',
  description: 'Park at the boat ramp.\nPermit in the bag.',
  shootDate: '2026-06-15',
  archivedAt: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
  viewpointCount: 3,
  upcomingViewpointCount: 0,
};

const base: ViewpointDto = {
  id: 'v1',
  projectId: 'p1',
  label: 'Beach, noon',
  latitude: 21.397,
  longitude: -157.727,
  elevationM: 3,
  timezone: 'Pacific/Honolulu',
  headingDeg: 270,
  pitchDeg: 5,
  fieldOfViewDeg: 60,
  focalLengthEquivalentMm: 24,
  selectedDatetimeUtc: '2026-05-31T22:30:00Z',
  weatherMode: 'SCENARIO',
  weatherScenario: 'overcast',
  previewSourceType: 'ESTIMATED_PREVIEW',
  parentViewpointId: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('shot list', () => {
  it('states each viewpoint in its own zone with the sun, and the night bodies for night shots', () => {
    const day = shotBlock(base);
    expect(day[0]).toBe('Beach, noon');
    expect(day[1]).toBe('  When:    2026-05-31 12:30 (Pacific/Honolulu)');
    expect(day[2]).toBe('  Where:   21.39700, -157.72700 · 3 m');
    expect(day[3]).toBe('  Camera:  270° W, pitch 5°, 24 mm');
    expect(day[4]).toMatch(/^ {2}Sun: {5}89° up, \d+° /);
    expect(day[5]).toBe('  Day:     sunrise 05:48 · sunset 19:09');
    expect(day.some((l) => l.startsWith('  Moon:'))).toBe(false);
    expect(day.at(-2)).toBe('  Weather: Scenario (not a forecast): overcast');
    // Overcast noon: an incident-light estimate under the saved scenario, labelled as such.
    expect(day.at(-1)).toMatch(
      /^ {2}Light: {3}~EV 1[23]\.\d · 1\/\d+ s f\/8 ISO 100 \(overcast scenario, estimate\)$/,
    );
    // New-Moon night, 02:00 HST on 15 June: Moon down, core up in the SSW, dark sky.
    const night = shotBlock({ ...base, id: 'v2', selectedDatetimeUtc: '2026-06-15T12:00:00Z' });
    expect(night.find((l) => l.startsWith('  Moon:'))).toMatch(/^ {2}Moon: {4}down, \d+ % lit$/);
    expect(night.find((l) => l.startsWith('  Core:'))).toMatch(
      /^ {2}Core: {4}3\d° up, \d+° S(SW|W) — Astronomical night, core 3\d° up, Moon down$/,
    );
    // Full-Moon midnight (31 May 00:00 HST): the Moon is up, so the line adds how wide it is.
    const moonlit = shotBlock({ ...base, id: 'v3', selectedDatetimeUtc: '2026-05-31T10:00:00Z' });
    expect(moonlit.find((l) => l.startsWith('  Moon:'))).toMatch(
      /^ {2}Moon: {4}\d+° up, \d+° [NESW]+, (99|100) % lit, 0\.5\d° across$/,
    );
  });

  it('orders by time, nests variants under their parent, carries the notes and the honesty footer', () => {
    const later: ViewpointDto = {
      ...base,
      id: 'v3',
      label: 'Beach, dusk',
      selectedDatetimeUtc: '2026-06-01T05:00:00Z',
      weatherMode: 'FORECAST',
      weatherScenario: null,
    };
    const variant: ViewpointDto = {
      ...base,
      id: 'v4',
      selectedDatetimeUtc: '2026-05-31T16:30:00Z',
      parentViewpointId: 'v1',
    };
    const text = buildShotList(project, [later, variant, base], {
      appUrl: 'https://app.example',
      generatedAt: new Date('2026-05-02T00:00:00Z'),
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Kailua weekend — shot list');
    expect(lines[1]).toBe('Shoot date: 2026-06-15');
    expect(lines[2]).toBe('3 viewpoints');
    expect(text).toContain('Notes:\n  Park at the boat ramp.\n  Permit in the bag.');
    // Parent (noon), then its variant indented (06:30), then the later viewpoint.
    const noon = text.indexOf('Beach, noon\n');
    const variantAt = text.indexOf('    Beach, noon\n      When:    2026-05-31 06:30');
    const dusk = text.indexOf('Beach, dusk\n');
    expect(noon).toBeGreaterThan(-1);
    expect(variantAt).toBeGreaterThan(noon);
    expect(dusk).toBeGreaterThan(variantAt);
    expect(text).toContain('  Weather: Forecast at save time (check again before the day)');
    // A forecast-saved viewpoint without a stored cloud figure reads as a clear sky and says so;
    // with one, the light follows the cloud it was saved under.
    expect(text).toMatch(
      / {2}Light: {3}~EV -?\d+\.\d · [\d/]+ (s|min) f\/[\d.]+ ISO \d+ \(clear sky, estimate\)/,
    );
    const cloudy = shotBlock({ ...later, cloudCoverAtSave: 90 });
    expect(cloudy.find((l) => l.startsWith('  Weather:'))).toBe(
      '  Weather: Forecast at save time (90 % cloud; check again before the day)',
    );
    expect(cloudy.find((l) => l.startsWith('  Light:'))).toMatch(
      /\(90 % cloud at save time, estimate\)$/,
    );
    // The forecast around the shot when the caller can supply it from the planner's cache.
    const withNow = shotBlock(later, undefined, 'metric', () => ({
      verdict: 'clear',
      meanCloudCover: 12.4,
    }));
    expect(withNow.find((l) => l.startsWith('  Now:'))).toBe(
      '  Now:     forecast 12 % cloud around the shot, clear — direct light',
    );
    expect(
      shotBlock(later, undefined, 'metric', () => null).some((l) => l.startsWith('  Now:')),
    ).toBe(false);
    expect(text).toContain('  Open:    https://app.example/?viewpoint=v3');
    expect(shotBlock(base).some((l) => l.startsWith('  Open:'))).toBe(false);
    // No shoot date: no stray blank line between the title and the count; imperial heights.
    const bare = buildShotList({ ...project, shootDate: null }, [base], {
      appUrl: 'https://app.example',
      generatedAt: new Date('2026-05-02T00:00:00Z'),
      units: 'imperial',
    });
    expect(bare.startsWith('Kailua weekend — shot list\n1 viewpoint\n\n')).toBe(true);
    expect(bare).toContain('  Where:   21.39700, -157.72700 · 10 ft');
    expect(text).toContain('a scenario is not a forecast.');
    expect(
      text.endsWith('Made with LightMap · https://app.example · 2026-05-02T00:00:00.000Z'),
    ).toBe(true);
    expect(text).not.toContain('\n\n\n');
  });
});

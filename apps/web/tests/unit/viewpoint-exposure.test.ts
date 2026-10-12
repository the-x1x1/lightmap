import { describe, expect, it } from 'vitest';
import { viewpointExposure } from '../../features/projects/viewpoint-exposure.ts';

const base = {
  latitude: 21.397,
  longitude: -157.727,
  selectedDatetimeUtc: '2026-05-31T22:30:00.000Z', // noon HST
  weatherMode: 'SCENARIO' as const,
  weatherScenario: 'overcast',
  cloudCoverAtSave: null,
};

describe('viewpointExposure', () => {
  it('follows the saved scenario, the cloud at save time, or a clear sky', () => {
    const overcast = viewpointExposure(base).ev100;
    const clear = viewpointExposure({ ...base, weatherScenario: 'clear' }).ev100;
    expect(clear - overcast).toBeGreaterThan(2);
    expect(clear).toBeGreaterThan(15);
    const forecastCloudy = viewpointExposure({
      ...base,
      weatherMode: 'FORECAST',
      weatherScenario: null,
      cloudCoverAtSave: 95,
    }).ev100;
    expect(Math.abs(forecastCloudy - overcast)).toBeLessThan(1);
    const forecastUnknown = viewpointExposure({
      ...base,
      weatherMode: 'FORECAST',
      weatherScenario: null,
    }).ev100;
    expect(forecastUnknown).toBeCloseTo(clear, 6);
    // A night viewpoint reads the Moon.
    const night = viewpointExposure({
      ...base,
      selectedDatetimeUtc: '2026-05-31T10:00:00.000Z',
      weatherScenario: 'clear',
    });
    expect(night.basis).toBe('moon');
  });
});

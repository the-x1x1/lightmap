import { describe, expect, it } from 'vitest';
import { DEFAULT_COLOR_TEMPERATURE_CURVE, SCENARIOS, colorTemperatureKelvin, isScenarioId, kelvinToRgb, parametersForForecast, scenarioById, scenarioForConditions, warmthFromKelvin } from '../src/scenarios.ts';

describe('scenarios are deterministic and visibly distinct', () => {
  it('has the five plan scenarios in order of increasing cloud', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['clear', 'mostly-clear', 'partly-cloudy', 'overcast', 'storm']);
    for (let i = 1; i < SCENARIOS.length; i++) {
      expect(SCENARIOS[i]!.parameters.cloudCover).toBeGreaterThanOrEqual(SCENARIOS[i - 1]!.parameters.cloudCover);
      expect(SCENARIOS[i]!.parameters.sunTransmittance).toBeLessThan(SCENARIOS[i - 1]!.parameters.sunTransmittance);
      expect(SCENARIOS[i]!.parameters.diffuseFraction).toBeGreaterThan(SCENARIOS[i - 1]!.parameters.diffuseFraction);
    }
  });

  it('clear vs partly cloudy vs overcast differ by a large margin (plan §10 "must be obvious")', () => {
    const c = scenarioById('clear').parameters;
    const p = scenarioById('partly-cloudy').parameters;
    const o = scenarioById('overcast').parameters;
    expect(c.sunTransmittance - p.sunTransmittance).toBeGreaterThan(0.2);
    expect(p.sunTransmittance - o.sunTransmittance).toBeGreaterThan(0.3);
    expect(o.contrast).toBeLessThan(0.8);
    expect(c.contrast).toBe(1);
    expect(o.cloudOpacity).toBeGreaterThan(0.9);
    expect(c.cloudOpacity).toBeLessThan(0.1);
  });

  it('same id → identical parameters (no randomness)', () => {
    expect(scenarioById('overcast').parameters).toEqual(scenarioById('overcast').parameters);
    expect(isScenarioId('storm')).toBe(true);
    expect(isScenarioId('sunny')).toBe(false);
  });

  it('labels forecast conditions', () => {
    expect(scenarioForConditions(3)).toBe('clear');
    expect(scenarioForConditions(30)).toBe('mostly-clear');
    expect(scenarioForConditions(60)).toBe('partly-cloudy');
    expect(scenarioForConditions(90)).toBe('overcast');
    expect(scenarioForConditions(40, { precipitationMm: 2 })).toBe('storm');
    expect(scenarioForConditions(40, { weatherCode: 95 })).toBe('storm');
  });

  it('forecast parameters interpolate between anchors and respond to low cloud, fog and rain', () => {
    const mid = parametersForForecast({ cloudCoverTotal: 75 });
    const partly = scenarioById('partly-cloudy').parameters;
    const over = scenarioById('overcast').parameters;
    expect(mid.sunTransmittance).toBeLessThan(partly.sunTransmittance);
    expect(mid.sunTransmittance).toBeGreaterThan(over.sunTransmittance);

    const lowCloud = parametersForForecast({ cloudCoverTotal: 50, cloudCoverLow: 50 });
    const highCloud = parametersForForecast({ cloudCoverTotal: 50, cloudCoverLow: 0 });
    expect(lowCloud.sunTransmittance).toBeLessThan(highCloud.sunTransmittance);

    const fog = parametersForForecast({ cloudCoverTotal: 20, visibility: 500 });
    expect(fog.haze).toBeGreaterThan(0.9);
    expect(fog.sunTransmittance).toBeLessThanOrEqual(0.15);

    const rain = parametersForForecast({ cloudCoverTotal: 90, precipitationAmount: 4, precipitationProbability: 90 });
    expect(rain.precipitation).toBeGreaterThan(0.5);
    expect(rain.skyLuminance).toBeLessThan(over.skyLuminance);

    // Exactly at an anchor reproduces the anchor.
    expect(parametersForForecast({ cloudCoverTotal: 95 }).contrast).toBeCloseTo(over.contrast, 6);
  });
});

describe('colour temperature curve', () => {
  it('is warm at the horizon and neutral at altitude', () => {
    expect(colorTemperatureKelvin(0)).toBeLessThan(3200);
    expect(colorTemperatureKelvin(3)).toBeLessThan(4000);
    expect(colorTemperatureKelvin(45)).toBeGreaterThan(5400);
    expect(colorTemperatureKelvin(-8)).toBeGreaterThan(7000); // blue hour is blue
    expect(colorTemperatureKelvin(-30)).toBe(DEFAULT_COLOR_TEMPERATURE_CURVE[0]!.kelvin);
  });
  it('is configurable', () => {
    expect(colorTemperatureKelvin(10, [{ elevationDeg: 0, kelvin: 1000 }, { elevationDeg: 20, kelvin: 3000 }])).toBe(2000);
  });
  it('maps kelvin to warmth and a plausible tint', () => {
    expect(warmthFromKelvin(2900)).toBeCloseTo(1, 5);
    expect(warmthFromKelvin(5600)).toBeCloseTo(0.5, 5);
    expect(warmthFromKelvin(9000)).toBeCloseTo(0, 5);
    const warm = kelvinToRgb(3000);
    const cool = kelvinToRgb(9000);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
    expect(kelvinToRgb(5600).every((c) => c > 0.9)).toBe(true);
  });
});

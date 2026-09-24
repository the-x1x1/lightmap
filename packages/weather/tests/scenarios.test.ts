import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOR_TEMPERATURE_CURVE,
  SCENARIOS,
  cloudLayersFromFrame,
  colorTemperatureKelvin,
  isScenarioId,
  kelvinToRgb,
  parametersForForecast,
  scenarioById,
  scenarioForConditions,
  warmthFromKelvin,
} from '../src/scenarios.ts';

describe('scenarios are deterministic and visibly distinct', () => {
  it('has the five plan scenarios in order of increasing cloud', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      'clear',
      'mostly-clear',
      'partly-cloudy',
      'overcast',
      'storm',
    ]);
    for (let i = 1; i < SCENARIOS.length; i++) {
      expect(SCENARIOS[i]!.parameters.cloudCover).toBeGreaterThanOrEqual(
        SCENARIOS[i - 1]!.parameters.cloudCover,
      );
      expect(SCENARIOS[i]!.parameters.sunTransmittance).toBeLessThan(
        SCENARIOS[i - 1]!.parameters.sunTransmittance,
      );
      expect(SCENARIOS[i]!.parameters.diffuseFraction).toBeGreaterThan(
        SCENARIOS[i - 1]!.parameters.diffuseFraction,
      );
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
    expect(scenarioForConditions(40, { precipitationAmount: 2 })).toBe('storm');
    // A frame object (the real caller) with amount-only rain and no code must read as storm.
    expect(
      scenarioForConditions(40, {
        cloudCoverTotal: 40,
        precipitationAmount: 5,
        precipitationProbability: 50,
        weatherCode: null,
      } as { precipitationAmount: number }),
    ).toBe('storm');
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

    const rain = parametersForForecast({
      cloudCoverTotal: 90,
      precipitationAmount: 4,
      precipitationProbability: 90,
    });
    expect(rain.precipitation).toBeGreaterThan(0.5);
    expect(rain.skyLuminance).toBeLessThan(over.skyLuminance);

    // Exactly at an anchor reproduces the anchor.
    expect(parametersForForecast({ cloudCoverTotal: 95 }).contrast).toBeCloseTo(over.contrast, 6);
  });
});

describe('cloud layers', () => {
  it('every scenario carries a representative low/mid/high split that grows with cover', () => {
    for (const s of SCENARIOS) {
      const l = s.parameters.cloudLayers;
      expect(s.parameters.layersObserved).toBe(false);
      for (const v of [l.low, l.mid, l.high]) expect(v >= 0 && v <= 1).toBe(true);
    }
    expect(scenarioById('clear').parameters.cloudLayers.low).toBe(0);
    expect(scenarioById('overcast').parameters.cloudLayers.low).toBeGreaterThan(0.6);
    expect(scenarioById('storm').parameters.cloudLayers.low).toBe(1);
  });
  it("uses the provider's layers when the frame has them and says so", () => {
    const p = parametersForForecast({
      cloudCoverTotal: 60,
      cloudCoverLow: 10,
      cloudCoverMid: 0,
      cloudCoverHigh: 60,
    });
    expect(p.layersObserved).toBe(true);
    expect(p.cloudLayers).toEqual({ low: 0.1, mid: 0, high: 0.6 });
    expect(cloudLayersFromFrame({ cloudCoverLow: null, cloudCoverMid: null })).toBeNull();
    expect(cloudLayersFromFrame({ cloudCoverLow: 40 })).toEqual({ low: 0.4, mid: 0, high: 0 });
  });
  it('interpolates the scenario split when the frame has no layers', () => {
    const p = parametersForForecast({ cloudCoverTotal: 75 });
    expect(p.layersObserved).toBe(false);
    const partly = scenarioById('partly-cloudy').parameters.cloudLayers;
    const over = scenarioById('overcast').parameters.cloudLayers;
    expect(p.cloudLayers.low).toBeGreaterThan(partly.low);
    expect(p.cloudLayers.low).toBeLessThan(over.low);
  });
  it('a thin high veil keeps more direct light than the same total of low cloud', () => {
    const cirrus = parametersForForecast({
      cloudCoverTotal: 70,
      cloudCoverLow: 0,
      cloudCoverMid: 5,
      cloudCoverHigh: 70,
    });
    const stratus = parametersForForecast({
      cloudCoverTotal: 70,
      cloudCoverLow: 70,
      cloudCoverMid: 0,
      cloudCoverHigh: 0,
    });
    expect(cirrus.sunTransmittance).toBeGreaterThan(stratus.sunTransmittance + 0.25);
    expect(cirrus.sunTransmittance).toBeLessThan(1);
    expect(stratus.cloudDensity).toBeGreaterThan(cirrus.cloudDensity);
    // Shadows survive under the veil: the diffuse share is capped by the surviving beam.
    expect(cirrus.diffuseFraction).toBeLessThanOrEqual(1 - 0.6 * cirrus.sunTransmittance + 1e-9);
    expect(cirrus.diffuseFraction).toBeLessThan(stratus.diffuseFraction);
  });
  it('rain pushes an unobserved split toward the storm deck but leaves observed layers alone', () => {
    const rainy = parametersForForecast({ cloudCoverTotal: 80, precipitationAmount: 3 });
    expect(rainy.cloudLayers.low).toBeGreaterThan(
      scenarioById('overcast').parameters.cloudLayers.low - 0.1,
    );
    const observed = parametersForForecast({
      cloudCoverTotal: 80,
      cloudCoverLow: 20,
      cloudCoverMid: 70,
      cloudCoverHigh: 0,
      precipitationAmount: 3,
    });
    expect(observed.cloudLayers).toEqual({ low: 0.2, mid: 0.7, high: 0 });
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
    expect(
      colorTemperatureKelvin(10, [
        { elevationDeg: 0, kelvin: 1000 },
        { elevationDeg: 20, kelvin: 3000 },
      ]),
    ).toBe(2000);
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

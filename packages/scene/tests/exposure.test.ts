import { describe, expect, it } from 'vitest';
import {
  airMass,
  clearSkyIlluminanceLux,
  cloudIlluminanceFactor,
  describeExposure,
  describeLightKelvin,
  estimateExposure,
  formatShutter,
  moonlightLux,
  nearestShutter,
} from '../src/exposure.ts';

describe('clear-sky illuminance', () => {
  it('air mass is 1 at the zenith and about 38 on the horizon', () => {
    expect(airMass(90)).toBeCloseTo(1, 2);
    expect(airMass(30)).toBeCloseTo(2, 1);
    expect(airMass(0)).toBeGreaterThan(35);
    expect(airMass(0)).toBeLessThan(40);
  });
  it('runs from ~130 klx overhead through ~57 klx at 30° to 600 lx at sunset and 3–4 lx at civil dusk', () => {
    expect(clearSkyIlluminanceLux(90) / 1000).toBeGreaterThan(120);
    expect(clearSkyIlluminanceLux(90) / 1000).toBeLessThan(135);
    expect(clearSkyIlluminanceLux(30) / 1000).toBeGreaterThan(50);
    expect(clearSkyIlluminanceLux(30) / 1000).toBeLessThan(65);
    expect(clearSkyIlluminanceLux(0)).toBeCloseTo(600, 0);
    expect(clearSkyIlluminanceLux(-6)).toBeGreaterThan(3);
    expect(clearSkyIlluminanceLux(-6)).toBeLessThan(4);
    // Monotonic through the day.
    let prev = -1;
    for (let h = -18; h <= 90; h += 1) {
      const e = clearSkyIlluminanceLux(h);
      expect(e).toBeGreaterThan(prev);
      prev = e;
    }
  });
  it('cloud keeps the day between 5 % and all of the clear sky', () => {
    expect(cloudIlluminanceFactor(1)).toBe(1);
    expect(cloudIlluminanceFactor(0)).toBeCloseTo(0.05, 9);
    expect(cloudIlluminanceFactor(0.2)).toBeCloseTo(0.135, 2);
    expect(cloudIlluminanceFactor(2)).toBe(1);
  });
  it('moonlight: ~0.26 lx under a full Moon overhead, a tenth of that at half, none below the horizon', () => {
    expect(moonlightLux(90, 1)).toBeCloseTo(0.26, 6);
    expect(moonlightLux(90, 0.5) / moonlightLux(90, 1)).toBeCloseTo(0.1, 1);
    expect(moonlightLux(-5, 1)).toBe(0);
    expect(moonlightLux(30, 1)).toBeCloseTo(0.13, 2);
  });
});

describe('estimateExposure', () => {
  it('the classic marks: sunny noon ≈ EV 15–16 at f/8 1/1000, overcast ≈ EV 12–13, sunset ≈ EV 8', () => {
    const noon = estimateExposure({ sunElevationDeg: 89, sunTransmittance: 1 });
    expect(noon.ev100).toBeGreaterThan(15);
    expect(noon.ev100).toBeLessThan(16);
    expect(noon.setting).toEqual({ aperture: 8, shutter: '1/1000 s', iso: 100 });
    expect(noon.basis).toBe('sun');
    const overcast = estimateExposure({ sunElevationDeg: 89, sunTransmittance: 0.2 });
    expect(overcast.ev100).toBeGreaterThan(12);
    expect(overcast.ev100).toBeLessThan(13.5);
    const sunset = estimateExposure({ sunElevationDeg: 0, sunTransmittance: 1 });
    expect(sunset.ev100).toBeCloseTo(7.9, 0);
    expect(sunset.setting).toEqual({ aperture: 4, shutter: '1/60 s', iso: 400 });
  });
  it('twilight, moonlight and starlight: the basis names the source, the setting opens up', () => {
    const dusk = estimateExposure({ sunElevationDeg: -6, sunTransmittance: 1 });
    expect(dusk.basis).toBe('twilight');
    expect(dusk.ev100).toBeGreaterThan(0);
    expect(dusk.ev100).toBeLessThan(1);
    expect(dusk.setting.iso).toBe(3200);
    const moon = estimateExposure({
      sunElevationDeg: -30,
      sunTransmittance: 1,
      moon: { elevationDeg: 60, illuminatedFraction: 1 },
    });
    expect(moon.basis).toBe('moon');
    expect(moon.ev100).toBeGreaterThan(-4);
    expect(moon.ev100).toBeLessThan(-3);
    expect(moon.setting).toEqual({ aperture: 2.8, shutter: '2 s', iso: 3200 });
    const stars = estimateExposure({ sunElevationDeg: -30, sunTransmittance: 1, moon: null });
    expect(stars.basis).toBe('stars');
    expect(stars.ev100).toBeCloseTo(-10.3, 0);
    expect(stars.setting.shutter).toBe('4 min');
    // Cloud dims the night less than the day.
    const cloudy = estimateExposure({ sunElevationDeg: -30, sunTransmittance: 0.2, moon: null });
    expect(cloudy.illuminanceLux / stars.illuminanceLux).toBeCloseTo(0.52, 2);
  });
  it('town light raises the night floor, more under cloud, and names itself', () => {
    const night = { sunElevationDeg: -30, moon: null } as const;
    const dark = estimateExposure({ ...night, sunTransmittance: 1 });
    expect(estimateExposure({ ...night, sunTransmittance: 1, skyGlowRatio: 1 })).toEqual(dark);
    // A city sky (60x a natural one): about six stops brighter than the desert, and its own basis.
    const city = estimateExposure({ ...night, sunTransmittance: 1, skyGlowRatio: 60 });
    expect(city.basis).toBe('city glow');
    expect(city.ev100 - dark.ev100).toBeGreaterThan(5.5);
    expect(city.ev100 - dark.ev100).toBeLessThan(6.5);
    // Overcast over a city is brighter still (the cloud base lit orange), not darker.
    const cityCloud = estimateExposure({ ...night, sunTransmittance: 0.2, skyGlowRatio: 60 });
    expect(cityCloud.illuminanceLux).toBeGreaterThan(city.illuminanceLux * 2);
    // A full Moon high up still outshines a suburb's glow.
    const suburbMoon = estimateExposure({
      sunElevationDeg: -30,
      sunTransmittance: 1,
      moon: { elevationDeg: 60, illuminatedFraction: 1 },
      skyGlowRatio: 7,
    });
    expect(suburbMoon.basis).toBe('moon');
    // Out of range ratios are clamped.
    expect(
      estimateExposure({ ...night, sunTransmittance: 1, skyGlowRatio: 1e6 }).illuminanceLux,
    ).toBeCloseTo(city.illuminanceLux, 9);
  });

  it('an overcast sky never steps at the horizon and dims the dusk by a stop or two, not three', () => {
    const ev = (h: number) => estimateExposure({ sunElevationDeg: h, sunTransmittance: 0.2 }).ev100;
    for (let h = -3; h <= 8; h += 0.25) expect(Math.abs(ev(h + 0.25) - ev(h))).toBeLessThan(0.6);
    expect(Math.abs(ev(0.001) - ev(-0.001))).toBeLessThan(0.05);
    const clearDusk = estimateExposure({ sunElevationDeg: -6, sunTransmittance: 1 }).ev100;
    const dullDusk = ev(-6);
    expect(clearDusk - dullDusk).toBeGreaterThan(1);
    expect(clearDusk - dullDusk).toBeLessThan(2);
    // By day the full factor applies: overcast noon ≈ 18 klx.
    expect(
      estimateExposure({ sunElevationDeg: 89, sunTransmittance: 0.2 }).illuminanceLux / 1000,
    ).toBeCloseTo(17.6, 0);
  });

  it('formats the value with a true minus and standard shutter steps', () => {
    expect(describeExposure(estimateExposure({ sunElevationDeg: -30, sunTransmittance: 1 }))).toBe(
      'EV −10.3 · 4 min f/2.8 ISO 3200',
    );
    expect(formatShutter(1 / 500)).toBe('1/500 s');
    expect(formatShutter(30)).toBe('30 s');
    expect(formatShutter(240)).toBe('4 min');
    expect(nearestShutter(1 / 400)).toBeCloseTo(1 / 500, 9);
    expect(nearestShutter(0.0035)).toBeCloseTo(1 / 250, 9);
    expect(nearestShutter(1000)).toBe(240);
  });
});

describe('the light’s colour line', () => {
  it('names the moonlit ground’s white balance when the Moon lights the scene', () => {
    const night = { sunElevationDeg: -30, sunTransmittance: 1 };
    const full = estimateExposure({
      ...night,
      moon: { elevationDeg: 40, illuminatedFraction: 1 },
    });
    expect(full.basis).toBe('moon');
    expect(describeLightKelvin(11000, full)).toBe('11000 K · moonlit ground ~4100 K');
    // Behind the sampled skyline the ground is in the ridge's shadow: the sky's figure only.
    expect(describeLightKelvin(11000, full, false)).toBe('11000 K');
    expect(describeLightKelvin(11000, full, true)).toBe('11000 K · moonlit ground ~4100 K');
    // A moonless night and the day keep the sky's figure alone.
    expect(describeLightKelvin(11000, estimateExposure({ ...night, moon: null }))).toBe('11000 K');
    expect(
      describeLightKelvin(5600, estimateExposure({ sunElevationDeg: 50, sunTransmittance: 1 })),
    ).toBe('5600 K');
  });
});

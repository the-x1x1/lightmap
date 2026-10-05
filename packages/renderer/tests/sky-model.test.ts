import { describe, expect, it } from 'vitest';
import {
  clearSkyStops,
  mieScaleForHaze,
  skyExposure,
  skyRadiance,
  toneMap,
} from '../src/sky-model.ts';

const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('single-scattering sky model (Phase 4 atmospheric scattering)', () => {
  it('a high Sun gives a Rayleigh-blue zenith: blue > green > red, blue several times red', () => {
    const z = skyRadiance({ sunElevationDeg: 70, viewElevationDeg: 90, relativeAzimuthDeg: 180 });
    expect(z[2]).toBeGreaterThan(z[1]);
    expect(z[1]).toBeGreaterThan(z[0]);
    expect(z[2] / z[0]).toBeGreaterThan(2.5);
    expect(z[2] / z[0]).toBeLessThan(6); // ∝ λ⁻⁴ would be 5.7 before extinction
  });

  it('the horizon is brighter and paler than the zenith by day (the long path)', () => {
    const z = skyRadiance({ sunElevationDeg: 60, viewElevationDeg: 90, relativeAzimuthDeg: 180 });
    const h = skyRadiance({ sunElevationDeg: 60, viewElevationDeg: 2, relativeAzimuthDeg: 90 });
    expect(lum(h)).toBeGreaterThan(lum(z));
    expect(h[2] / h[0]).toBeLessThan(z[2] / z[0]);
  });

  it('a setting Sun reddens its side of the horizon; a high Sun does not', () => {
    const sunset = skyRadiance({
      sunElevationDeg: 0.5,
      viewElevationDeg: 2,
      relativeAzimuthDeg: 25,
    });
    expect(sunset[0]).toBeGreaterThan(sunset[1]);
    expect(sunset[1]).toBeGreaterThan(sunset[2]);
    const noon = skyRadiance({ sunElevationDeg: 60, viewElevationDeg: 2, relativeAzimuthDeg: 25 });
    expect(sunset[0] / sunset[2]).toBeGreaterThan(5 * (noon[0] / noon[2]));
  });

  it('haze pales the sky (less blue-to-red contrast overhead) and scales monotonically', () => {
    const clear = skyRadiance({
      sunElevationDeg: 50,
      viewElevationDeg: 90,
      relativeAzimuthDeg: 180,
      haze: 0.1,
    });
    const hazy = skyRadiance({
      sunElevationDeg: 50,
      viewElevationDeg: 90,
      relativeAzimuthDeg: 180,
      haze: 0.7,
    });
    expect(hazy[2] / hazy[0]).toBeLessThan(clear[2] / clear[0]);
    expect(mieScaleForHaze(0)).toBeLessThan(mieScaleForHaze(0.5));
    expect(mieScaleForHaze(0.5)).toBeLessThan(mieScaleForHaze(1));
    expect(mieScaleForHaze(2)).toBe(mieScaleForHaze(1)); // clamped
  });

  it("the Earth's shadow: the sky goes dark once the Sun is well down; the ground is black", () => {
    const noon = skyRadiance({ sunElevationDeg: 60, viewElevationDeg: 90, relativeAzimuthDeg: 0 });
    const dusk = skyRadiance({ sunElevationDeg: -10, viewElevationDeg: 90, relativeAzimuthDeg: 0 });
    expect(lum(dusk)).toBeLessThan(0.01 * lum(noon));
    // Looking down from 2 m: some twenty metres of air before the ground, next to nothing in-scattered.
    const ground = skyRadiance({
      sunElevationDeg: 60,
      viewElevationDeg: -5,
      relativeAzimuthDeg: 0,
    });
    expect(lum(ground)).toBeLessThan(0.005 * lum(noon));
  });

  it("is symmetric about the Sun's vertical", () => {
    const a = skyRadiance({ sunElevationDeg: 20, viewElevationDeg: 10, relativeAzimuthDeg: 60 });
    const b = skyRadiance({ sunElevationDeg: 20, viewElevationDeg: 10, relativeAzimuthDeg: -60 });
    for (let c = 0; c < 3; c++) expect(a[c]).toBeCloseTo(b[c], 10);
  });

  it('tone mapping keeps chromaticity, clips at white, and the exposure anchors a mid-blue zenith', () => {
    const k = skyExposure();
    const z = skyRadiance({
      sunElevationDeg: 45,
      viewElevationDeg: 90,
      relativeAzimuthDeg: 0,
      haze: 0.1,
    });
    const mapped = toneMap(z, k);
    // sRGB (80, 140, 220) has linear luminance ≈ 0.26: the anchor.
    const linear = mapped.map((v) => Math.pow(v / 255, 2.2)) as [number, number, number];
    expect(lum(linear)).toBeCloseTo(0.26, 1);
    expect(mapped[2]).toBeGreaterThan(mapped[0]);
    expect(toneMap([100, 100, 100], k)).toEqual([255, 255, 255]);
    expect(toneMap([0, 0, 0], k)).toEqual([0, 0, 0]);
    // A dim orange keeps its hue ordering through the map.
    const dim = toneMap([0.02, 0.012, 0.004], k);
    expect(dim[0]).toBeGreaterThan(dim[1]);
    expect(dim[1]).toBeGreaterThan(dim[2]);
  });

  it('gradient stops: blue overhead at noon, warm glow stop at sunset, nothing looks into the Sun', () => {
    const noon = clearSkyStops(85);
    expect(noon.zenith[2]).toBeGreaterThan(noon.zenith[0] + 60);
    expect(noon.mid[2]).toBeGreaterThan(noon.mid[0] + 60);
    // Overhead stays a blue even with the Sun at the zenith (sampled 40° away from it).
    const overhead = clearSkyStops(90);
    expect(overhead.zenith[2]).toBeGreaterThan(overhead.zenith[0] + 60);
    const sunset = clearSkyStops(0.5);
    expect(sunset.horizon[0]).toBeGreaterThan(sunset.horizon[2] + 100);
  });
});

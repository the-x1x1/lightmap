import { describe, expect, it } from 'vitest';
import {
  APERTURE_STOPS,
  circleOfConfusionMm,
  depthOfField,
  feetFromMetres,
  formatDistance,
  formatDistanceM,
  formatHeight,
  hyperfocalDistanceM,
  metresFromFeet,
} from '../src/optics.ts';
import { SENSOR_PRESETS, defaultCamera } from '../src/camera.ts';

describe('depth of field', () => {
  it('circle of confusion is the diagonal / 1500 (full frame ≈ 0.029 mm, APS-C ≈ 0.019 mm)', () => {
    expect(circleOfConfusionMm(36, 24)).toBeCloseTo(0.02884, 5);
    expect(circleOfConfusionMm(23.5, 15.6)).toBeCloseTo(0.0188, 4);
    // Height defaults to a 3:2 frame.
    expect(circleOfConfusionMm(36)).toBeCloseTo(circleOfConfusionMm(36, 24), 12);
    for (const s of SENSOR_PRESETS) expect(s.heightMm).toBeLessThan(s.widthMm);
  });

  it('matches the textbook case: 50 mm f/8 at 5 m, c = 0.03 mm → 3.39–9.53 m, H = 10.47 m', () => {
    const d = depthOfField({ focalLengthMm: 50, aperture: 8, focusDistanceM: 5, cocMm: 0.03 });
    expect(d.hyperfocalM).toBeCloseTo(10.467, 3);
    expect(d.nearM).toBeCloseTo(3.389, 3);
    expect(d.farM).toBeCloseTo(9.527, 3);
    expect(d.totalM).toBeCloseTo(6.138, 3);
    expect(d.infinitySharp).toBe(false);
    // More of the zone lies behind the focus point than in front of it at this distance.
    expect(d.frontShare).toBeGreaterThan(0.2);
    expect(d.frontShare).toBeLessThan(0.5);
  });

  it('focused at the hyperfocal distance, everything from half of it to infinity is sharp', () => {
    const c = circleOfConfusionMm(36, 24);
    const H = hyperfocalDistanceM(24, 11, c);
    expect(H).toBeCloseTo(1.839, 3);
    const d = depthOfField({ focalLengthMm: 24, aperture: 11, focusDistanceM: H, cocMm: c });
    expect(d.infinitySharp).toBe(true);
    expect(d.farM).toBe(Infinity);
    expect(d.totalM).toBe(Infinity);
    expect(d.frontShare).toBeNull();
    expect(d.nearM).toBeCloseTo(0.9197, 3);
    // Past the hyperfocal distance the far limit stays at infinity.
    expect(
      depthOfField({ focalLengthMm: 24, aperture: 11, focusDistanceM: 50, cocMm: c }).farM,
    ).toBe(Infinity);
  });

  it('stopping down always deepens the zone; a longer lens always thins it', () => {
    const c = 0.029;
    let prev = 0;
    for (const N of APERTURE_STOPS) {
      const d = depthOfField({ focalLengthMm: 85, aperture: N, focusDistanceM: 3, cocMm: c });
      expect(d.totalM).toBeGreaterThan(prev);
      prev = d.totalM;
    }
    const wide = depthOfField({ focalLengthMm: 35, aperture: 4, focusDistanceM: 3, cocMm: c });
    const tele = depthOfField({ focalLengthMm: 135, aperture: 4, focusDistanceM: 3, cocMm: c });
    expect(tele.totalM).toBeLessThan(wide.totalM);
  });

  it('the same framing on a smaller sensor (shorter real lens, smaller c) gives more depth', () => {
    // 50 mm on full frame vs the ~33 mm that frames the same on APS-C, both f/2.8 at 4 m.
    const ff = depthOfField({
      focalLengthMm: 50,
      aperture: 2.8,
      focusDistanceM: 4,
      cocMm: circleOfConfusionMm(36, 24),
    });
    const aps = depthOfField({
      focalLengthMm: (50 * 23.5) / 36,
      aperture: 2.8,
      focusDistanceM: 4,
      cocMm: circleOfConfusionMm(23.5, 15.6),
    });
    expect(aps.totalM).toBeGreaterThan(ff.totalM * 1.3);
  });

  it('a focus distance inside the focal length is clamped instead of going negative', () => {
    const d = depthOfField({
      focalLengthMm: 100,
      aperture: 2.8,
      focusDistanceM: 0.01,
      cocMm: 0.03,
    });
    expect(d.nearM).toBeGreaterThan(0);
    expect(d.farM).toBeGreaterThanOrEqual(d.nearM);
  });

  it('formats distances compactly', () => {
    expect(formatDistanceM(0.85)).toBe('85 cm');
    expect(formatDistanceM(3.389)).toBe('3.4 m');
    expect(formatDistanceM(12.4)).toBe('12 m');
    expect(formatDistanceM(1234)).toBe('1.2 km');
    expect(formatDistanceM(Infinity)).toBe('∞');
  });

  it('formats imperial distances in inches, feet and miles; metric is unchanged', () => {
    expect(formatDistance(3.389, 'metric')).toBe('3.4 m');
    expect(formatDistance(0.2, 'imperial')).toBe('8 in');
    expect(formatDistance(1, 'imperial')).toBe('3.3 ft');
    expect(formatDistance(3.389, 'imperial')).toBe('11 ft');
    expect(formatDistance(250, 'imperial')).toBe('820 ft');
    expect(formatDistance(1500, 'imperial')).toBe('4921 ft');
    expect(formatDistance(1609.344, 'imperial')).toBe('1.0 mi');
    expect(formatDistance(4000, 'imperial')).toBe('2.5 mi');
    expect(formatDistance(Infinity, 'imperial')).toBe('∞');
    expect(formatHeight(1234, 'metric')).toBe('1234 m');
    expect(formatHeight(1234, 'imperial')).toBe('4049 ft');
    expect(metresFromFeet(feetFromMetres(7.5))).toBeCloseTo(7.5, 12);
  });

  it('defaultCamera takes the preferred lens, clamped to the planner frustum', () => {
    const eye = { latitude: 0, longitude: 0 };
    expect(defaultCamera(eye).focalLengthMm).toBe(24);
    expect(defaultCamera(eye, 0, 35).focalLengthMm).toBe(35);
    expect(defaultCamera(eye, 0, 35).fovDeg).toBeCloseTo(54.4, 1);
    // 600 mm would be 3.4°: the 5° floor wins and the lens figure follows it.
    const tele = defaultCamera(eye, 0, 600);
    expect(tele.fovDeg).toBe(5);
    expect(tele.focalLengthMm).toBeCloseTo(412.3, 0);
    // 8 mm would be 132°: capped at 120°.
    expect(defaultCamera(eye, 0, 8).fovDeg).toBe(120);
    expect(defaultCamera(eye, 0, Number.NaN).focalLengthMm).toBe(24);
    expect(defaultCamera(eye, 0, -5).focalLengthMm).toBe(24);
  });
});

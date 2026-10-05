import { describe, expect, it } from 'vitest';
import { blendHeading, cameraPointingFromOrientation } from '../src/orientation.ts';

const abs = (alpha: number, beta: number, gamma: number) =>
  cameraPointingFromOrientation({ alpha, beta, gamma, absolute: true })!;

describe('device orientation → camera pointing', () => {
  it('an upright phone facing north points its back camera north and level', () => {
    const p = abs(0, 90, 0);
    expect(p.headingDeg).toBeCloseTo(0, 6);
    expect(p.pitchDeg).toBeCloseTo(0, 6);
  });
  it('alpha turns the phone counter-clockwise: 90 → camera west, 270 → east, 45 → north-west', () => {
    expect(abs(90, 90, 0).headingDeg).toBeCloseTo(270, 6);
    expect(abs(270, 90, 0).headingDeg).toBeCloseTo(90, 6);
    expect(abs(45, 90, 0).headingDeg).toBeCloseTo(315, 6);
  });
  it('tilting back raises the camera, tilting forward lowers it', () => {
    expect(abs(0, 120, 0).pitchDeg).toBeCloseTo(30, 6);
    expect(abs(0, 60, 0).pitchDeg).toBeCloseTo(-30, 6);
    // Flat on a table, screen up: the camera looks straight down.
    expect(abs(0, 0, 0).pitchDeg).toBeCloseTo(-90, 6);
  });
  it('reports roll: upright facing north, rolled 30° clockwise (right edge down)', () => {
    // Euler angles found numerically for that pose (R = Rz·Rx·Ry).
    const p = abs(90, 120, -90);
    expect(p.headingDeg).toBeCloseTo(0, 6);
    expect(p.pitchDeg).toBeCloseTo(0, 6);
    expect(p.rollDeg).toBeCloseTo(30, 6);
    expect(abs(0, 90, 0).rollDeg).toBeCloseTo(0, 6);
    // Landscape facing north, top of the phone to the left: rolled 90° counter-clockwise.
    const landscape = abs(90, 0, -90);
    expect(landscape.headingDeg).toBeCloseTo(0, 6);
    expect(landscape.rollDeg).toBeCloseTo(-90, 6);
  });
  it('matches an independently computed general case', () => {
    const p = abs(30, 100, -45);
    expect(p.headingDeg).toBeCloseTo(15.439, 2);
    expect(p.pitchDeg).toBeCloseTo(7.053, 2);
  });
  it('iOS: uses webkitCompassHeading when alpha is only relative', () => {
    const p = cameraPointingFromOrientation({
      alpha: 123, // arbitrary start-relative value
      beta: 90,
      gamma: 0,
      absolute: false,
      webkitCompassHeading: 90, // device top points east → back camera points east
    })!;
    expect(p.headingDeg).toBeCloseTo(90, 6);
    expect(p.pitchDeg).toBeCloseTo(0, 6);
  });
  it('refuses to invent a heading without a compass reference or with bad numbers', () => {
    expect(
      cameraPointingFromOrientation({ alpha: 10, beta: 90, gamma: 0, absolute: false }),
    ).toBeNull();
    expect(
      cameraPointingFromOrientation({ alpha: Number.NaN, beta: 90, gamma: 0, absolute: true }),
    ).toBeNull();
  });
  it('blendHeading crosses north without the 359→0 jump', () => {
    expect(blendHeading(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(blendHeading(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(blendHeading(90, 100, 0.25)).toBeCloseTo(92.5, 9);
    // A 180° turn must not stall: after a few samples the blend has clearly moved.
    let h = 270;
    for (let i = 0; i < 5; i++) h = blendHeading(h, 90, 0.35);
    expect(Math.abs(h - 90)).toBeLessThan(60);
    expect(blendHeading(0, 180, 0.5)).toBe(180); // opposite headings: take the new one
    expect(blendHeading(45, 45, 0.3)).toBeCloseTo(45, 6);
  });
});

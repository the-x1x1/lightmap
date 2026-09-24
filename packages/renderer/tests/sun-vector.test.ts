import { describe, expect, it } from 'vitest';
import {
  angleBetweenDeg,
  azElFromEcefToward,
  ecefToEnu,
  enuToEcef,
  enuTowardSun,
  shadowOnGround,
  sunLightDirectionEcef,
} from '../src/sun-vector.ts';

describe('azimuth/elevation → renderer world vector (plan §10)', () => {
  it('ENU basis: east is +x, north +y, up +z', () => {
    const e = enuTowardSun(90, 0);
    expect(e.x).toBeCloseTo(1, 9);
    expect(e.y).toBeCloseTo(0, 9);
    const n = enuTowardSun(0, 0);
    expect(n.y).toBeCloseTo(1, 9);
    const up = enuTowardSun(123, 90);
    expect(up.z).toBeCloseTo(1, 9);
  });

  it('at (0°, 0°) "up" is the ECEF +X axis and "north" is +Z', () => {
    const up = enuToEcef({ x: 0, y: 0, z: 1 }, 0, 0);
    expect(up.x).toBeCloseTo(1, 9);
    expect(up.z).toBeCloseTo(0, 9);
    const north = enuToEcef({ x: 0, y: 1, z: 0 }, 0, 0);
    expect(north.z).toBeCloseTo(1, 9);
    const east = enuToEcef({ x: 1, y: 0, z: 0 }, 0, 0);
    expect(east.y).toBeCloseTo(1, 9);
  });

  it('at the north pole "up" is +Z', () => {
    const up = enuToEcef({ x: 0, y: 0, z: 1 }, 90, 0);
    expect(up.z).toBeCloseTo(1, 9);
    expect(Math.abs(up.x)).toBeLessThan(1e-9);
  });

  it('round-trips ENU ↔ ECEF and az/el', () => {
    const v = enuTowardSun(210, 37);
    const back = ecefToEnu(enuToEcef(v, 21.4, -157.7), 21.4, -157.7);
    expect(back.x).toBeCloseTo(v.x, 9);
    expect(back.y).toBeCloseTo(v.y, 9);
    expect(back.z).toBeCloseTo(v.z, 9);
    const ae = azElFromEcefToward(enuToEcef(v, 21.4, -157.7), 21.4, -157.7);
    expect(ae.azimuthDeg).toBeCloseTo(210, 6);
    expect(ae.elevationDeg).toBeCloseTo(37, 6);
  });

  it('light direction is the negation of "toward the sun" and is unit length', () => {
    const toward = enuToEcef(enuTowardSun(120, 30), 51.5, -0.13);
    const light = sunLightDirectionEcef(120, 30, 51.5, -0.13);
    expect(light.x).toBeCloseTo(-toward.x, 9);
    expect(light.y).toBeCloseTo(-toward.y, 9);
    expect(light.z).toBeCloseTo(-toward.z, 9);
    expect(Math.hypot(light.x, light.y, light.z)).toBeCloseTo(1, 9);
    expect(angleBetweenDeg(light, toward)).toBeCloseTo(180, 6);
  });

  it('a sun on the horizon lights tangentially; noon sun at the equator on an equinox points down the local vertical', () => {
    const up = enuToEcef({ x: 0, y: 0, z: 1 }, 21.4, -157.7);
    const light = sunLightDirectionEcef(90, 0, 21.4, -157.7);
    expect(Math.abs(light.x * up.x + light.y * up.y + light.z * up.z)).toBeLessThan(1e-9);
    const noon = sunLightDirectionEcef(180, 90, 0, 0);
    expect(noon.x).toBeCloseTo(-1, 9);
  });

  it('shadow falls opposite the sun and lengthens toward the horizon', () => {
    expect(shadowOnGround(90, 45)).toMatchObject({ azimuthDeg: 270 });
    expect(shadowOnGround(90, 45).lengthPerMetre).toBeCloseTo(1, 9);
    expect(shadowOnGround(0, 10).lengthPerMetre!).toBeGreaterThan(5);
    expect(shadowOnGround(0, -3).lengthPerMetre).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { localSelectionToUtc } from '@lightmap/astronomy';
import {
  DEFAULT_RENDER_SETTINGS,
  buildSceneState,
  defaultCamera,
  type EnvironmentState,
  type SceneInputs,
} from '@lightmap/scene';
import { OPEN_METEO_CAPABILITIES, type WeatherScenarioId } from '@lightmap/weather';
import { lightingFromScene, skyGradientFor } from '../src/lighting.ts';
import { azElFromEcefToward, type Vec3 } from '../src/sun-vector.ts';

const neg = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });

const kailua = {
  point: { latitude: 21.397, longitude: -157.727 },
  timeZone: 'Pacific/Honolulu',
  label: 'Kailua Beach',
  source: 'search' as const,
};
const env: EnvironmentState = {
  terrainAvailable: true,
  terrainProviderId: 'reearth-mapterhorn-terrain',
  basemapProviderId: 'xyz-imagery',
  basemapDetail: 'street',
  buildingsAvailable: false,
  groundElevationM: 2,
  attributions: [],
  fixtureMode: false,
};

function scene(
  hourLocal: number,
  scenario: WeatherScenarioId = 'clear',
  over: Partial<SceneInputs> = {},
) {
  return buildSceneState({
    location: kailua,
    utc: localSelectionToUtc({ year: 2026, month: 5, day: 31 }, hourLocal * 60, kailua.timeZone),
    now: new Date('2026-05-01T00:00:00Z'),
    camera: defaultCamera(kailua.point, 90),
    environment: env,
    scenario,
    forceScenario: true,
    weather: { capabilities: OPEN_METEO_CAPABILITIES, frames: [], providerFailed: false },
    render: DEFAULT_RENDER_SETTINGS,
    includeLunar: false,
    realReference: false,
    ...over,
  });
}

describe('lightingFromScene', () => {
  it('noon clear: strong neutral light, shadows on, dark shadows', () => {
    const l = lightingFromScene(scene(12.5, 'clear'));
    expect(l.sunIntensity).toBeGreaterThan(1.8);
    expect(l.directLightPresent).toBe(true);
    expect(l.shadowsEnabled).toBe(true);
    expect(l.shadowDarkness).toBeLessThan(0.4);
    expect(l.sunColor.every((c) => c > 0.9)).toBe(true);
    expect(l.grade.nightFactor).toBe(0);
  });

  it('noon overcast: weak diffuse light, shadows off, desaturated grey sky', () => {
    const clear = lightingFromScene(scene(12.5, 'clear'));
    const over = lightingFromScene(scene(12.5, 'overcast'));
    expect(over.sunIntensity).toBeLessThan(clear.sunIntensity * 0.3);
    expect(over.shadowsEnabled).toBe(true); // transmittance 0.2 > 0.12 keeps faint shadows
    expect(over.shadowDarkness).toBeGreaterThan(clear.shadowDarkness + 0.3);
    expect(over.atmosphere.saturationShift).toBeLessThan(clear.atmosphere.saturationShift - 0.2);
    expect(over.grade.cloudOpacity).toBeGreaterThan(0.9);
    expect(over.grade.contrast).toBeLessThan(0.8);
    const storm = lightingFromScene(scene(12.5, 'storm'));
    expect(storm.shadowsEnabled).toBe(false);
    expect(storm.grade.precipitation).toBe(1);
  });

  it('aerial perspective grows toward the horizon at low sun and the shader gets the elevation', () => {
    const noon = lightingFromScene(scene(12.5, 'clear'));
    const golden = lightingFromScene(scene(18.75, 'clear'));
    const overcastGolden = lightingFromScene(scene(18.75, 'overcast'));
    expect(golden.grade.horizonHaze).toBeGreaterThan(noon.grade.horizonHaze + 0.15);
    expect(golden.grade.horizonHaze).toBeLessThanOrEqual(1);
    // Cloud cover already flattens the scene; the low-sun term is halved under a full deck.
    expect(overcastGolden.grade.horizonHaze - overcastGolden.grade.haze).toBeLessThan(
      golden.grade.horizonHaze - golden.grade.haze,
    );
    expect(golden.grade.sunElevation).toBeGreaterThan(2);
    expect(golden.grade.sunElevation).toBeLessThan(7);
    expect(noon.atmosphere.brightnessShift).toBeLessThan(golden.atmosphere.brightnessShift);
  });

  it('golden hour is warm and dimmer; blue hour has no direct light and is cool', () => {
    const golden = lightingFromScene(scene(18.75, 'clear')); // sunset 19:09 → ~+4°
    expect(golden.sunColor[0]).toBeGreaterThan(golden.sunColor[2] + 0.2);
    expect(golden.sunIntensity).toBeLessThan(lightingFromScene(scene(12.5)).sunIntensity);
    expect(golden.grade.warmth).toBeGreaterThan(0.7);
    const blue = lightingFromScene(scene(19.5, 'clear')); // ≈ −5°
    expect(blue.directLightPresent).toBe(false);
    expect(blue.shadowsEnabled).toBe(false);
    expect(blue.grade.warmth).toBeLessThan(0.5);
    expect(blue.grade.nightFactor).toBeGreaterThan(0);
    const night = lightingFromScene(scene(23, 'clear'));
    expect(night.grade.nightFactor).toBeCloseTo(1, 3);
    expect(night.sunIntensity).toBe(0);
    expect(night.starsVisible).toBe(true);
    expect(blue.starsVisible).toBe(false);
    // Blue hour keeps a dim, cool ambient and lifts the atmosphere light to a grazing angle.
    expect(blue.sunIntensity).toBeGreaterThan(0.1);
    expect(blue.sunIntensity).toBeLessThan(0.5);
    expect(blue.sunColor[2]).toBeGreaterThan(blue.sunColor[0]);
    const trueEl = azElFromEcefToward(neg(blue.sunDirectionEcef), 21.397, -157.727).elevationDeg;
    const litEl = azElFromEcefToward(neg(blue.lightDirectionEcef), 21.397, -157.727).elevationDeg;
    expect(trueEl).toBeLessThan(-4);
    expect(litEl).toBeCloseTo(-0.6, 6);
    expect(lightingFromScene(scene(12.5)).lightDirectionEcef).toEqual(
      lightingFromScene(scene(12.5)).sunDirectionEcef,
    );
  });

  it('light direction follows the sun across the day', () => {
    const am = lightingFromScene(scene(8));
    const pm = lightingFromScene(scene(16));
    // Morning light travels westward (sun in the east); evening light travels eastward.
    const dotAm =
      am.sunDirectionEcef.x * pm.sunDirectionEcef.x +
      am.sunDirectionEcef.y * pm.sunDirectionEcef.y +
      am.sunDirectionEcef.z * pm.sunDirectionEcef.z;
    expect(dotAm).toBeLessThan(0.5);
    expect(am.shadow.azimuthDeg).toBeGreaterThan(180); // shadows fall west-ish in the morning
    expect(pm.shadow.azimuthDeg).toBeLessThan(180);
  });

  it('haze drives fog density; clear skies produce a blue gradient and overcast a grey one', () => {
    expect(lightingFromScene(scene(12, 'storm')).fogDensity).toBeGreaterThan(
      lightingFromScene(scene(12, 'clear')).fogDensity * 3,
    );
    const [zenithClear] = skyGradientFor(45, 0, 0.5, 1);
    const [zenithOver] = skyGradientFor(45, 0.95, 0.5, 0.85);
    const rgb = (s: string) => s.match(/\d+/g)!.map(Number) as [number, number, number];
    const c = rgb(zenithClear);
    const o = rgb(zenithOver);
    expect(c[2] - c[0]).toBeGreaterThan(80); // blue dominant
    expect(Math.abs(o[0] - o[2])).toBeLessThan(30); // grey
    const [nz] = skyGradientFor(-25, 0, 0.2, 1);
    expect(rgb(nz)[0]).toBeLessThan(20); // night is dark
    const [, , horizonSunset] = skyGradientFor(-2, 0.05, 0.9, 1);
    const h = rgb(horizonSunset);
    expect(h[0]).toBeGreaterThan(h[2]); // warm glow at the horizon
  });
});

describe('moonlight', () => {
  it('lights the night scene from the Moon when it is up and the Sun is below −12°', () => {
    // Kailua, 31 May 2026 23:00 HST: full moon high in the sky, sun ≈ −33°.
    const night = lightingFromScene(scene(23, 'clear', { includeLunar: true }));
    expect(night.moonlit).toBe(true);
    expect(night.sunIntensity).toBeGreaterThan(0.08);
    expect(night.sunIntensity).toBeLessThan(0.2);
    expect(night.sunColor[2]).toBeGreaterThan(night.sunColor[0]); // cool
    const dir = azElFromEcefToward(neg(night.lightDirectionEcef), 21.397, -157.727);
    expect(dir.elevationDeg).toBeGreaterThan(2);
    expect(night.starsVisible).toBe(true);
    const noMoon = lightingFromScene(scene(23, 'clear', { includeLunar: false }));
    expect(noMoon.moonlit).toBe(false);
    expect(noMoon.sunIntensity).toBe(0);
  });
});

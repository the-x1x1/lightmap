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
import {
  STAR_FIELD_FROM_DEG,
  lightingFromScene,
  globeLightSplit,
  horizonSkyFor,
  seaSlopeVarianceFor,
  seaSkyFor,
  skyGradientFor,
  starFieldVisibility,
  visibilityFromHaze,
  windTowardFor,
  mistFor,
  snowShareFor,
  cloudBaseKmFor,
} from '../src/lighting.ts';
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
  it('a rainbow in showers with the Sun out and under 42 deg, and not otherwise', () => {
    const showers = (hour: number) => {
      const s = scene(hour, 'partly-cloudy');
      return {
        ...s,
        atmosphere: {
          ...s.atmosphere,
          parameters: { ...s.atmosphere.parameters, precipitation: 0.15, sunTransmittance: 0.7 },
        },
      };
    };
    expect(lightingFromScene(showers(17.5)).grade.rainbow).toBeGreaterThan(0.9);
    // The Sun too high at noon: the bow is under the horizon.
    expect(lightingFromScene(showers(12.5)).grade.rainbow).toBe(0);
    // No rain; or rain with no Sun through it.
    expect(lightingFromScene(scene(17.5, 'clear')).grade.rainbow).toBe(0);
    expect(lightingFromScene(scene(17.5, 'storm')).grade.rainbow).toBe(0);
  });

  it('the low deck sits at the cloud base given by the dew point', () => {
    expect(cloudBaseKmFor({ temperature: 26, dewPoint: 20 })).toBeCloseTo(0.75, 6);
    expect(cloudBaseKmFor({ temperature: 30, dewPoint: 0 })).toBe(2.5);
    expect(cloudBaseKmFor({ temperature: 15, dewPoint: 15 })).toBe(0.3);
    expect(cloudBaseKmFor({ temperature: 15, dewPoint: null })).toBe(1.5);
    expect(cloudBaseKmFor(null)).toBe(1.5);
    expect(lightingFromScene(scene(12, 'partly-cloudy')).grade.lowDeckKm).toBe(1.5);
  });

  it('what falls is snow by the weather code, or by the cold where the code does not say', () => {
    expect(snowShareFor({ weatherCode: 73, temperature: 3 })).toBe(1); // the code says snow
    expect(snowShareFor({ weatherCode: 61, temperature: -3 })).toBe(0); // rain, whatever the cold
    expect(snowShareFor({ weatherCode: 66, temperature: -1 })).toBe(0); // freezing rain is liquid
    expect(snowShareFor({ weatherCode: 85 })).toBe(1); // snow showers
    expect(snowShareFor({ weatherCode: null, temperature: -4 })).toBe(1);
    expect(snowShareFor({ weatherCode: null, temperature: 1 })).toBeCloseTo(0.5, 6); // sleet
    expect(snowShareFor({ weatherCode: 3, temperature: 5 })).toBe(0);
    expect(snowShareFor({ weatherCode: null })).toBe(0);
    expect(snowShareFor(null)).toBe(0);
    // A scenario's rain is rain in Kailua: no flakes.
    const storm = lightingFromScene(scene(12, 'storm')).grade;
    expect(storm.snowfall).toBe(0);
    expect(storm.precipitation).toBeGreaterThan(0);
    // In Fairbanks in January a scenario's storm is snow (the lying snow's season), and a snow
    // shower throws no rainbow; in July it is rain again.
    const fairbanks = {
      ...kailua,
      point: { latitude: 64.84, longitude: -147.72, elevationM: 136 },
      timeZone: 'America/Anchorage',
    };
    const winter = lightingFromScene(
      scene(12, 'storm', { location: fairbanks, utc: new Date('2026-01-15T21:00:00Z') }),
    ).grade;
    expect(winter.snowfall).toBeCloseTo(winter.precipitation, 6);
    expect(winter.rainbow).toBe(0);
    const summer = lightingFromScene(
      scene(12, 'storm', { location: fairbanks, utc: new Date('2026-07-15T21:00:00Z') }),
    ).grade;
    expect(summer.snowfall).toBe(0);
  });

  it("alpenglow: the beam on high ground is shown through the place's sunset, in its exposure", () => {
    // Kailua, 31 May: the Sun is 0.9 deg down at 19:09:36 (the place's own beam has just gone),
    // 4.3 deg up at 18:45, 11 deg down at 20:00.
    const justDown = lightingFromScene(scene(19.16)).grade.alpenglow;
    // The twilight is shown some three times brighter than it is, and the peaks' beam with it.
    expect(justDown).toBeGreaterThan(2);
    expect(justDown).toBeLessThan(5);
    // With the Sun 4 deg up the peaks' share is nearly the place's: fading (gone by 6 deg).
    const low = lightingFromScene(scene(18.75)).grade.alpenglow;
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(0.6);
    expect(lightingFromScene(scene(12)).grade.alpenglow).toBe(0);
    // No ground on Earth stands high enough to see a Sun 11 deg down.
    expect(lightingFromScene(scene(20)).grade.alpenglow).toBe(0);
    // Cloud takes it as it takes the beam.
    expect(lightingFromScene(scene(19.16, 'overcast')).grade.alpenglow).toBeLessThan(
      0.25 * justDown,
    );
  });

  it('valley mist in calm near-saturated air before the Sun is up 15 deg, none without a forecast', () => {
    const f = (o: Partial<Parameters<typeof mistFor>[0] & object> = {}) => ({
      humidity: 97,
      visibility: 20000,
      windSpeed: 0.5,
      weatherCode: 1,
      cloudCoverLow: 0,
      ...o,
    });
    expect(mistFor(f(), 2, 0)).toBeCloseTo(1, 6);
    expect(mistFor(f(), 20, 0)).toBe(0); // burnt off
    expect(mistFor(f({ windSpeed: 6 }), 2, 0)).toBe(0); // stirred away
    expect(mistFor(f({ humidity: 70 }), 2, 0)).toBe(0); // dry air
    expect(mistFor(f({ humidity: 70, weatherCode: 45 }), 2, 0)).toBeCloseTo(1, 6); // fog
    expect(mistFor(f({ cloudCoverLow: 100 }), 2, 0)).toBeCloseTo(0.4, 6); // a low overcast
    expect(mistFor(f(), 2, 0.5)).toBe(0); // rain
    expect(mistFor(null, 2, 0)).toBe(0);
    expect(lightingFromScene(scene(6, 'clear')).grade.mist).toBe(0);
  });

  it('the wind blows the decks where the forecast sends them, a trade wind without one', () => {
    const [e, n] = windTowardFor(0); // from the north: toward the south
    expect(e).toBeCloseTo(0, 6);
    expect(n).toBeCloseTo(-1, 6);
    const [te, tn] = windTowardFor(null); // the trades, from 67.5 deg: toward the west-south-west
    expect(te).toBeLessThan(-0.9);
    expect(tn).toBeLessThan(-0.3);
    expect(lightingFromScene(scene(12.5, 'clear')).grade.windMps).toBeGreaterThan(0);
  });

  it('sunbeams with a low Sun getting through, none at noon or under a storm', () => {
    expect(lightingFromScene(scene(18.75, 'clear')).grade.rays).toBeGreaterThan(0.3);
    expect(lightingFromScene(scene(12.5, 'clear')).grade.rays).toBe(0);
    expect(lightingFromScene(scene(18.75, 'storm')).grade.rays).toBe(0);
  });

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

  it('cloud decks: scenario split for scenarios, the forecast layers when a frame is in force', () => {
    const clear = lightingFromScene(scene(12.5, 'clear'));
    expect(clear.grade.cloudLow).toBe(0);
    expect(clear.grade.cloudHigh).toBeLessThan(0.1);
    const over = lightingFromScene(scene(12.5, 'overcast'));
    expect(over.grade.cloudLow).toBeGreaterThan(0.6);
    expect(over.grade.cloudMid).toBeGreaterThan(0.6);
    // A forecast frame with only cirrus: the decks follow the frame, direct light largely survives.
    const utc = localSelectionToUtc({ year: 2026, month: 5, day: 31 }, 12.5 * 60, kailua.timeZone);
    const cirrus = lightingFromScene(
      scene(12.5, 'clear', {
        now: new Date('2026-05-30T00:00:00Z'),
        forceScenario: false,
        weather: {
          capabilities: OPEN_METEO_CAPABILITIES,
          providerFailed: false,
          frames: [
            {
              timestamp: utc.toISOString(),
              cloudCoverTotal: 85,
              cloudCoverLow: 0,
              cloudCoverMid: 5,
              cloudCoverHigh: 85,
              precipitationProbability: 0,
              precipitationAmount: 0,
              humidity: 60,
              visibility: 40000,
              windSpeed: 3,
              windDirection: 90,
              weatherCode: 2,
            },
          ],
        },
      }),
    );
    expect(cirrus.grade.cloudHigh).toBeCloseTo(0.85, 6);
    expect(cirrus.grade.cloudLow).toBe(0);
    expect(cirrus.directLightPresent).toBe(true);
    expect(cirrus.shadowsEnabled).toBe(true);
    expect(cirrus.sunIntensity).toBeGreaterThan(over.sunIntensity * 2);
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
    // At −5° the star field is not drawn yet (from −8°, fading in to −16°).
    expect(blue.starsVisible).toBe(false);
    expect(golden.starsVisible).toBe(false);
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
    // Haze pales the overhead blue (the scattering model's Mie term).
    const clearZ = rgb(skyGradientFor(40, 0, 0.5, 1, 0.1)[0]);
    const hazyZ = rgb(skyGradientFor(40, 0, 0.5, 1, 0.7)[0]);
    expect(hazyZ[2] - hazyZ[0]).toBeLessThan(clearZ[2] - clearZ[0]);
  });

  it('the sea mirrors the low sky: blue by day, orange toward a setting Sun only, grey under cloud, dark at night', () => {
    const day = seaSkyFor(45, 0, 0.5, 1);
    expect(day.away[2]).toBeGreaterThan(day.away[0]); // blue
    expect(day.away).toEqual(day.toward); // no glow by day
    for (const v of [...day.away, ...day.toward]) expect(v).toBeLessThanOrEqual(1);
    // After sunset the light turns cool, but the afterglow on the Sun's side stays warm to a few
    // degrees down (by the Sun's depression, not the light's warmth), and is gone by -7 deg.
    const after = seaSkyFor(-2, 0, 0.3, 1);
    expect(after.toward[0]).toBeGreaterThan(after.toward[2]);
    const late = seaSkyFor(-7, 0, 0, 1);
    expect(late.toward[2]).toBeGreaterThan(late.toward[0]);
    const sunset = seaSkyFor(-2, 0.05, 0.9, 1);
    expect(sunset.toward[0]).toBeGreaterThan(sunset.toward[2]); // the glow, on the Sun's side
    expect(sunset.toward[0]).toBeGreaterThan(sunset.away[0] + 0.1);
    expect(sunset.away[2]).toBeGreaterThanOrEqual(sunset.away[0]); // the other side stays cool
    const overcast = seaSkyFor(45, 0.95, 0.5, 0.85);
    expect(Math.abs(overcast.away[0] - overcast.away[2])).toBeLessThan(0.08); // a cool grey
    const night = seaSkyFor(-25, 0, 0.2, 1);
    expect(Math.max(...night.away)).toBeLessThan(0.2); // the night horizon's deep navy
    // ... darkened as the grade darkens the night dome: no lit band of sea under a black sky.
    expect(Math.max(...night.away)).toBeLessThan(0.04);
    // Through the dusk the dome stays bright low down: the sky in the water is lifted there.
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(lum(seaSkyFor(-4, 0, 0.6, 1).toward)).toBeGreaterThan(0.6);
    expect(night.away[2]).toBeLessThan(day.away[2] / 3);
    expect(night.away).toEqual(night.toward);
    // The scene carries it, in step with the gradient's horizon.
    expect(lightingFromScene(scene(12, 'clear')).seaSky.away[2]).toBeGreaterThan(0.5);
    // The haze colour is the horizon stop itself, as the gradient paints it, on both sides.
    const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
    const h = horizonSkyFor(-2, 0.05, 0.9, 1);
    const [, , horizonCss] = skyGradientFor(-2, 0.05, 0.9, 1);
    h.toward.forEach((v, i) => expect(v * 255).toBeCloseTo(rgb(horizonCss)[i]!, -0.5)); // within a count
    expect(h.away[0]).toBeLessThan(h.toward[0]);
    expect(lightingFromScene(scene(12, 'clear')).horizonSky.away[2]).toBeGreaterThan(0.8);
  });

  it('splits the globe light: relief under a clear Sun, little under overcast or in twilight, level ground as Cesium has it but lifted under a low Sun', () => {
    const level = (g: { lambert: number; ambient: number }, el: number) =>
      g.lambert * Math.max(0, Math.sin((el * Math.PI) / 180)) + g.ambient;
    // Cesium's level ground, lifted by up to 35 % as the Sun nears the horizon (gone by 25 deg).
    const sm = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const cesium = (el: number) =>
      (0.9 * Math.max(0, Math.sin((el * Math.PI) / 180)) + 0.3) * (1 + 0.35 * (1 - sm(4, 25, el)));
    for (const [el, d] of [
      [60, 0],
      [60, 1],
      [20, 0.5],
      [4, 0],
      [1, 0.9],
    ] as const) {
      const g = globeLightSplit(el, el, d);
      expect(level(g, el)).toBeCloseTo(cesium(el), 2);
    }
    // A clear Sun keeps Cesium's own split; a full overcast keeps a quarter of the relief.
    expect(globeLightSplit(60, 60, 0)).toEqual({ lambert: 0.9, ambient: 0.3, skyLift: 1 });
    expect(globeLightSplit(60, 60, 1).lambert).toBeCloseTo(0.225, 3);
    // Twilight: the light held at -0.6 deg, the Sun at -4 deg - a sixth of the relief, and the
    // whole of the light on level ground (it is all sky light), lifted 1/0.3 above a day's share.
    const tw = globeLightSplit(-0.6, -4, 0.2);
    expect(tw.lambert).toBeLessThan(0.16);
    expect(tw.ambient).toBe(1);
    expect(tw.skyLift).toBeCloseTo(3.333, 2);
    // A moonless night is back at a day's share by -12 deg (no lift), so the Moon's split, which
    // takes over there, meets it without a jump.
    expect(globeLightSplit(-0.6, -14, 0).ambient).toBe(0.3);
    expect(globeLightSplit(-0.6, -9, 0).ambient).toBeGreaterThan(0.3);
    expect(globeLightSplit(-0.6, -9, 0).ambient).toBeLessThan(1);
    // By day there is no lift: the ambient share only takes up what the relief gives away.
    expect(globeLightSplit(30, 30, 0.5).skyLift).toBe(1);
    // Under a low Sun level ground comes up, through the sky's share (buildings too).
    expect(globeLightSplit(4, 4, 0).skyLift).toBeGreaterThan(1.3);
    // A clear Sun with its disc up keeps the whole beam's relief (a raking sunrise).
    expect(globeLightSplit(1, 1, 0).lambert).toBe(0.9);
    // The scene carries it.
    expect(lightingFromScene(scene(12, 'overcast')).globeLight.lambert).toBeLessThan(0.5);
    expect(lightingFromScene(scene(12, 'clear')).globeLight.lambert).toBeGreaterThan(0.75);
  });

  it('roughens the sea by the wind, after Cox and Munk', () => {
    expect(seaSlopeVarianceFor(0)).toBe(0.003);
    expect(seaSlopeVarianceFor(5)).toBeCloseTo(0.0286, 4);
    expect(seaSlopeVarianceFor(100)).toBeCloseTo(0.1054, 4); // held at 20 m/s
    expect(seaSlopeVarianceFor(Number.NaN)).toBeCloseTo(0.0286, 4);
    // A scenario's typical wind: a breeze when clear, a gale in a storm.
    expect(lightingFromScene(scene(12, 'clear')).seaSlopeVariance).toBeCloseTo(0.0235, 4);
    expect(lightingFromScene(scene(12, 'storm')).seaSlopeVariance).toBeGreaterThan(0.06);
  });

  it('the water mirrors the disc of the light only while there is one: the Sun up, or the Moon by night', () => {
    expect(lightingFromScene(scene(12, 'clear')).glitter).toBe(1);
    expect(lightingFromScene(scene(12, 'overcast')).glitter).toBeLessThan(0.5);
    // Kailua, 31 May 2026: sunset ~19:12; at 19:30 the light is held at the horizon, no disc.
    expect(lightingFromScene(scene(19.5, 'clear')).glitter).toBe(0);
  });

  it('the dome Mie coefficient follows haze only behind the physicalSkyDome flag', () => {
    expect(lightingFromScene(scene(12, 'storm')).atmosphere.mieCoefficient).toBeUndefined();
    const physical = { ...DEFAULT_RENDER_SETTINGS, physicalSkyDome: true };
    const clearMie = lightingFromScene(scene(12, 'clear', { render: physical })).atmosphere
      .mieCoefficient;
    const stormMie = lightingFromScene(scene(12, 'storm', { render: physical })).atmosphere
      .mieCoefficient;
    expect(clearMie).toBeGreaterThan(0);
    expect(stormMie).toBeGreaterThan(clearMie! * 2);
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
    // The town's lights are on at night, off by day.
    expect(night.cityLights).toBe(1);
    expect(lightingFromScene(scene(12, 'clear')).cityLights).toBe(0);
    // A full Moon high up casts shadows as a clear day's are; with no Moon there are none.
    expect(night.shadowsEnabled).toBe(true);
    expect(night.shadowDarkness).toBeLessThan(0.4);
    expect(noMoon.shadowsEnabled).toBe(false);
    // Overcast: the light is the cloud's, and the shade all but gone, as by day.
    const dull = lightingFromScene(scene(23, 'overcast', { includeLunar: true }));
    expect(dull.shadowDarkness).toBeGreaterThan(0.8);
  });
});

describe('visibility and fog', () => {
  it('maps haze to a visibility: ~60 km clear, ~20 km overcast, ~10 km rain, 4 km thick haze', () => {
    expect(visibilityFromHaze(0.1)).toBeGreaterThan(50_000);
    expect(visibilityFromHaze(0.45)).toBeGreaterThan(15_000);
    expect(visibilityFromHaze(0.45)).toBeLessThan(30_000);
    expect(visibilityFromHaze(0.7)).toBeCloseTo(9_800, -3);
    expect(visibilityFromHaze(1)).toBe(4000);
    expect(visibilityFromHaze(5)).toBe(4000);
  });

  it('overcast fog leaves the ground 1.5 km from the camera almost clear (it was a grey sheet)', () => {
    const d = lightingFromScene(scene(12, 'overcast')).fogDensity;
    const fogAt = (m: number) => 1 - Math.exp(-((d * m) ** 2));
    expect(fogAt(1500)).toBeLessThan(0.05);
    expect(fogAt(40_000)).toBeGreaterThan(0.9);
  });
});

describe('starFieldVisibility', () => {
  it('fades the stars in from −8° to −16°, monotonically', () => {
    expect(starFieldVisibility(-3)).toBe(0);
    expect(starFieldVisibility(STAR_FIELD_FROM_DEG)).toBe(0);
    expect(starFieldVisibility(-12)).toBeCloseTo(0.5, 6);
    expect(starFieldVisibility(-16)).toBe(1);
    expect(starFieldVisibility(-40)).toBe(1);
    let prev = 0;
    for (let el = -8; el >= -17; el -= 0.5) {
      const v = starFieldVisibility(el);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

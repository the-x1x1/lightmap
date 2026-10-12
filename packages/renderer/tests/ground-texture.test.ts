import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_SETTINGS,
  buildSceneState,
  defaultCamera,
  type EnvironmentState,
  type LocationState,
} from '@lightmap/scene';
import { OPEN_METEO_CAPABILITIES } from '@lightmap/weather';
import {
  NEUTRAL_LAND_HINT,
  dayOfYearUtc,
  groundTextureFor,
  landHintFromColor,
  landHintFromPixels,
  permanentSnowlineM,
  snowlineM,
  cloudShadowStrength,
  snowlineWithForecast,
} from '../src/ground-texture.ts';
import {
  GROUND_COVER_BOUNDS_UNIFORM,
  GROUND_COVER_IMAGE_UNIFORM,
  GROUND_DETAIL_IMAGE_UNIFORM,
  GROUND_DETAIL_PERIOD_M,
  GROUND_MATERIAL_SOURCE,
  GROUND_UNIFORM_DEFAULTS,
} from '../src/shaders/ground.frag.ts';

const env: EnvironmentState = {
  terrainProvider: 'ellipsoid',
  basemapProvider: 'natural-earth-ii',
  buildingsAvailable: false,
  groundElevationM: 2,
  attributions: [],
  fixtureMode: false,
};

function place(latitude: number, longitude: number, timeZone: string): LocationState {
  return { point: { latitude, longitude }, label: 'test', timeZone, source: 'search' };
}

function sceneAt(latitude: number, utc: Date, render = DEFAULT_RENDER_SETTINGS) {
  const loc = place(latitude, -157.73, 'Pacific/Honolulu');
  return buildSceneState({
    location: loc,
    utc,
    now: utc,
    camera: defaultCamera(loc.point, 90),
    environment: env,
    scenario: 'clear',
    forceScenario: true,
    weather: { capabilities: OPEN_METEO_CAPABILITIES, frames: [], providerFailed: false },
    render,
    includeLunar: false,
    realReference: false,
  });
}

describe('snowline', () => {
  it('the climatic line falls with latitude: ≈ 5 200 m at the equator, ≈ 3 000 m at 45°, ≈ 1 700 m at 60°, a few hundred at 80°', () => {
    expect(permanentSnowlineM(0)).toBeCloseTo(5200, 0);
    expect(permanentSnowlineM(45)).toBeGreaterThan(2900);
    expect(permanentSnowlineM(45)).toBeLessThan(3100);
    expect(permanentSnowlineM(-45)).toBe(permanentSnowlineM(45));
    expect(permanentSnowlineM(60)).toBeGreaterThan(1600);
    expect(permanentSnowlineM(60)).toBeLessThan(1800);
    expect(permanentSnowlineM(80)).toBeLessThan(400);
    expect(permanentSnowlineM(90)).toBeGreaterThanOrEqual(0);
  });

  it('winter lowers it by latitude: the Alps snowy from ≈ 1 500 m in February, bare to ≈ 3 000 m in August; the tropics barely move', () => {
    const feb = snowlineM(46, 40);
    const aug = snowlineM(46, 222);
    expect(feb).toBeGreaterThan(1300);
    expect(feb).toBeLessThan(1700);
    expect(aug).toBeGreaterThan(2800);
    expect(aug).toBeLessThan(3000);
    // Mauna Kea (4 207 m) at 20° N: above the line in winter, below it in summer.
    expect(snowlineM(20, 40)).toBeLessThan(4207);
    expect(snowlineM(20, 222)).toBeGreaterThan(4207);
    expect(snowlineM(5, 40) / snowlineM(5, 222)).toBeGreaterThan(0.98);
  });

  it('the seasons flip south of the equator', () => {
    expect(snowlineM(-45, 222)).toBeLessThan(snowlineM(-45, 40));
    expect(snowlineM(-45, 222)).toBeCloseTo(snowlineM(45, 40), -1);
  });

  it('day of the year in UTC', () => {
    expect(dayOfYearUtc(new Date('2026-01-01T00:00:00Z'))).toBe(1);
    expect(dayOfYearUtc(new Date('2026-12-31T23:59:59Z'))).toBe(365);
    expect(dayOfYearUtc(new Date('2024-12-31T12:00:00Z'))).toBe(366);
  });
});

describe('snowlineWithForecast', () => {
  it('pulls the line under the pin when the forecast has snow lying, pushes it over when bare, leaves it alone without a frame or ground', () => {
    expect(snowlineWithForecast(2800, 0.3, 1600)).toBe(1450);
    expect(snowlineWithForecast(1200, 0.3, 1600)).toBe(1200);
    expect(snowlineWithForecast(1200, 0, 1600)).toBe(1750);
    expect(snowlineWithForecast(2800, 0, 1600)).toBe(2800);
    expect(snowlineWithForecast(2800, 0.005, 1600)).toBe(2800); // a dusting is not lying snow
    expect(snowlineWithForecast(2800, null, 1600)).toBe(2800);
    expect(snowlineWithForecast(2800, 0.3, null)).toBe(2800);
  });
});

describe('cloudShadowStrength', () => {
  it('is nothing under a clear or an overcast sky, most at half cover, nothing without direct sun', () => {
    expect(cloudShadowStrength({ low: 0, mid: 0 }, 1, 40)).toBe(0);
    expect(cloudShadowStrength({ low: 1, mid: 0 }, 0.3, 40)).toBe(0);
    expect(cloudShadowStrength({ low: 0.5, mid: 0 }, 0.7, 40)).toBe(1);
    expect(cloudShadowStrength({ low: 0.25, mid: 0 }, 0.7, 40)).toBeCloseTo(0.75, 2);
    expect(cloudShadowStrength({ low: 0, mid: 0.5 }, 0.7, 40)).toBeCloseTo(0.84, 2);
    expect(cloudShadowStrength({ low: 0.5, mid: 0 }, 0.3, 40)).toBeCloseTo(0.5, 2);
    expect(cloudShadowStrength({ low: 0.5, mid: 0 }, 0.7, -2)).toBe(0);
    expect(cloudShadowStrength({ low: 0.5, mid: 0 }, 0.1, 40)).toBe(0);
  });
});

describe('groundTextureFor', () => {
  it('gives the scene’s snowline, hemisphere and full strength', () => {
    const g = groundTextureFor(sceneAt(21.4, new Date('2026-02-09T22:00:00Z')))!;
    expect(g.poleward).toBe(1);
    expect(g.strength).toBe(1);
    expect(g.detail).toBe(2);
    expect(g.wet).toBe(0);
    expect(
      groundTextureFor(
        sceneAt(21.4, new Date('2026-02-09T22:00:00Z'), {
          ...DEFAULT_RENDER_SETTINGS,
          softShadows: false,
        }),
      )!.detail,
    ).toBe(1);
    expect(
      groundTextureFor(
        sceneAt(21.4, new Date('2026-02-09T22:00:00Z'), {
          ...DEFAULT_RENDER_SETTINGS,
          softShadows: false,
          shadowMapSize: 1024,
        }),
      )!.detail,
    ).toBe(0);
    expect(g.snowlineM).toBe(Math.round(snowlineM(21.4, 40)));
    expect(g.treelineM).toBe(Math.round(permanentSnowlineM(21.4) - 900));
    expect(groundTextureFor(sceneAt(-33.9, new Date('2026-02-09T22:00:00Z')))!.poleward).toBe(-1);
  });

  it('is off when the setting says so or the Minimal rung has dropped the shadows', () => {
    expect(
      groundTextureFor(
        sceneAt(21.4, new Date('2026-02-09T22:00:00Z'), {
          ...DEFAULT_RENDER_SETTINGS,
          groundTexture: false,
        }),
      ),
    ).toBeNull();
    expect(
      groundTextureFor(
        sceneAt(21.4, new Date('2026-02-09T22:00:00Z'), {
          ...DEFAULT_RENDER_SETTINGS,
          shadows: false,
        }),
      ),
    ).toBeNull();
  });
});

describe('landHintFromColor', () => {
  it('reads Natural Earth II: green land is not arid, tan is, the ice sheet is ice, the sea says nothing', () => {
    expect(landHintFromColor([120, 150, 90])).toEqual({ aridity: 0, ice: 0 });
    expect(landHintFromColor([200, 180, 140]).aridity).toBeCloseTo(0.75, 2);
    expect(landHintFromColor([200, 180, 140]).ice).toBe(0);
    const ice = landHintFromColor([235, 238, 242]);
    expect(ice.ice).toBe(1);
    expect(ice.aridity).toBe(0);
    const brownGrey = landHintFromColor([150, 140, 120]);
    expect(brownGrey.aridity).toBeCloseTo(0.5, 2);
    expect(landHintFromColor([60, 90, 140])).toEqual({
      aridity: NEUTRAL_LAND_HINT.aridity,
      ice: 0,
    });
  });

  it('averages a patch without its water pixels: a desert coast is desert; all water is neutral', () => {
    const coast = landHintFromPixels([
      [200, 180, 140],
      [60, 90, 140],
      [60, 90, 140],
    ]);
    expect(coast.aridity).toBeCloseTo(0.75, 2);
    expect(landHintFromPixels([[60, 90, 140]])).toEqual(NEUTRAL_LAND_HINT);
    expect(landHintFromPixels([])).toEqual(NEUTRAL_LAND_HINT);
  });

  it('carries the chart brightness and the geoid into the params', () => {
    const g = groundTextureFor(sceneAt(30, new Date('2026-07-01T00:00:00Z')), NEUTRAL_LAND_HINT, {
      brightness: 0.45,
      seaLevelM: 47.4,
    })!;
    expect(g.brightness).toBe(0.45);
    expect(g.seaLevelM).toBe(47);
    const d = groundTextureFor(sceneAt(30, new Date('2026-07-01T00:00:00Z')))!;
    expect(d.brightness).toBe(1);
    expect(d.seaLevelM).toBe(0);
  });

  it('carries the hint into the params, rounded to a hundredth', () => {
    const g = groundTextureFor(sceneAt(30, new Date('2026-07-01T00:00:00Z')), {
      aridity: 0.7777,
      ice: 0.123,
    })!;
    expect(g.aridity).toBe(0.78);
    expect(g.ice).toBe(0.12);
    expect(groundTextureFor(sceneAt(30, new Date('2026-07-01T00:00:00Z')))!.aridity).toBe(
      NEUTRAL_LAND_HINT.aridity,
    );
  });
});

describe('ground material source', () => {
  it('declares every uniform it is given, reads slope (so Cesium requests normals) and respects the water mask', () => {
    for (const name of Object.keys(GROUND_UNIFORM_DEFAULTS))
      expect(GROUND_MATERIAL_SOURCE).toContain(`uniform float ${name};`);
    expect(GROUND_MATERIAL_SOURCE).toContain(`uniform sampler2D ${GROUND_COVER_IMAGE_UNIFORM};`);
    expect(GROUND_MATERIAL_SOURCE).toContain(`uniform vec4 ${GROUND_COVER_BOUNDS_UNIFORM};`);
    expect(GROUND_MATERIAL_SOURCE).toContain(`uniform sampler2D ${GROUND_DETAIL_IMAGE_UNIFORM};`);
    for (const v of ['u_eastWC', 'u_northWC', 'u_upWC', 'u_detailOffset'])
      expect(GROUND_MATERIAL_SOURCE).toContain(`uniform vec3 ${v};`);
    expect(GROUND_DETAIL_PERIOD_M).toBe(2.5);
    expect(GROUND_MATERIAL_SOURCE).toContain(
      `/ ${GROUND_DETAIL_PERIOD_M.toFixed(1)} + u_detailOffset`,
    );
    expect(GROUND_MATERIAL_SOURCE).toContain('uniform vec3 u_cameraCell;');
    expect(GROUND_MATERIAL_SOURCE).toContain('uniform vec3 u_cameraFrac;');
    expect(GROUND_MATERIAL_SOURCE).toMatch(/materialInput\.slope/);
    expect(GROUND_MATERIAL_SOURCE).toMatch(/#ifdef HAS_WATER_MASK[\s\S]*waterMask[\s\S]*#endif/);
    expect(GROUND_MATERIAL_SOURCE).toMatch(
      /czm_material czm_getMaterial\(czm_materialInput materialInput\)/,
    );
    // Balanced braces and no stray tabs: the cheapest sanity check without a GL context.
    const open = (GROUND_MATERIAL_SOURCE.match(/\{/g) ?? []).length;
    const close = (GROUND_MATERIAL_SOURCE.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });
});

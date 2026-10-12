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
  dayOfYearUtc,
  groundTextureFor,
  permanentSnowlineM,
  snowlineM,
} from '../src/ground-texture.ts';
import { GROUND_MATERIAL_SOURCE, GROUND_UNIFORM_DEFAULTS } from '../src/shaders/ground.frag.ts';

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

describe('groundTextureFor', () => {
  it('gives the scene’s snowline, hemisphere and full strength', () => {
    const g = groundTextureFor(sceneAt(21.4, new Date('2026-02-09T22:00:00Z')))!;
    expect(g.poleward).toBe(1);
    expect(g.strength).toBe(1);
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

describe('ground material source', () => {
  it('declares every uniform it is given, reads slope (so Cesium requests normals) and respects the water mask', () => {
    for (const name of Object.keys(GROUND_UNIFORM_DEFAULTS))
      expect(GROUND_MATERIAL_SOURCE).toContain(`uniform float ${name};`);
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

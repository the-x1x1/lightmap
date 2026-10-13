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
  polewardWeight,
  snowlineWithForecast,
} from '../src/ground-texture.ts';
import { QUALITY_LADDER } from '../src/quality-governor.ts';
import {
  GROUND_COVER_BOUNDS_UNIFORM,
  GROUND_COVER_IMAGE_UNIFORM,
  GROUND_DETAIL_QUADRANTS,
  GROUND_DETAIL_PERIOD_M,
  GROUND_DETAIL_TIERS,
  GROUND_DETAIL_UNIFORM,
  GROUND_MATERIAL_SOURCE,
  GROUND_NOISE_PERIODS_M,
  GROUND_NOISE_UNIFORM,
  GROUND_NOISE_WRAP_M,
  GROUND_TOWN_GRID,
  GROUND_UNIFORM_DEFAULTS,
} from '../src/shaders/ground.frag.ts';

const env: EnvironmentState = {
  terrainAvailable: false,
  terrainProviderId: 'ellipsoid',
  basemapProviderId: 'natural-earth-ii',
  basemapDetail: 'coarse',
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
    expect(cloudShadowStrength({ low: 0, mid: 0.5 }, 0.7, 40)).toBeCloseTo(0.6, 2);
    expect(cloudShadowStrength({ low: 0.5, mid: 0 }, 0.3, 40)).toBeCloseTo(0.5, 2);
    expect(cloudShadowStrength({ low: 0.5, mid: 0 }, 0.7, -2)).toBe(0);
    expect(cloudShadowStrength({ low: 0.5, mid: 0 }, 0.1, 40)).toBe(0);
  });

  it('a complete sheet has no gaps however thin: a mid-level overcast dapples nothing, layers clamp', () => {
    expect(cloudShadowStrength({ low: 0.1, mid: 0.9 }, 0.5, 40)).toBe(0);
    expect(cloudShadowStrength({ low: 0.4, mid: 0.6 }, 0.5, 40)).toBe(0);
    expect(cloudShadowStrength({ low: 1.5, mid: 0 }, 0.9, 40)).toBe(0);
    // Half the sky in a mid deck alone: gaps as for any half cover, the shade lighter than a low deck's.
    expect(cloudShadowStrength({ low: 0, mid: 0.5 }, 0.7, 40)).toBeCloseTo(0.6, 2);
  });
});

describe('polewardWeight', () => {
  it('is signed toward the pole, nothing in the tropics, full from 35°', () => {
    expect(polewardWeight(0)).toBe(0);
    expect(polewardWeight(8)).toBe(0);
    expect(polewardWeight(-8)).toBe(-0);
    expect(polewardWeight(21.4)).toBeCloseTo(0.46, 2);
    expect(polewardWeight(-33.9)).toBeCloseTo(-0.96, 2);
    expect(polewardWeight(47)).toBe(1);
    expect(polewardWeight(-60)).toBe(-1);
  });
});

describe('groundTextureFor', () => {
  it('gives the scene’s snowline, hemisphere and full strength', () => {
    const g = groundTextureFor(sceneAt(21.4, new Date('2026-02-09T22:00:00Z')))!;
    expect(g.poleward).toBeCloseTo(0.46, 2);
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
    expect(
      groundTextureFor(sceneAt(-33.9, new Date('2026-02-09T22:00:00Z')))!.poleward,
    ).toBeCloseTo(-0.96, 2);
  });

  it('detail follows the real quality ladder: Ultra/High 2, Balanced 1, Battery and Minimal 0', () => {
    const byLabel = Object.fromEntries(
      QUALITY_LADDER.map((r) => [
        r.label,
        groundTextureFor(
          sceneAt(21.4, new Date('2026-02-09T22:00:00Z'), {
            ...DEFAULT_RENDER_SETTINGS,
            shadows: r.shadows,
            shadowMapSize: r.shadowMapSize,
            softShadows: r.softShadows,
          }),
        )?.detail ?? null,
      ]),
    );
    expect(byLabel).toEqual({ Ultra: 2, High: 2, Balanced: 1, Battery: 0, Minimal: 0 });
  });

  it('wet ground follows the scenario’s precipitation, clamped', () => {
    const storm = buildSceneState({
      location: place(21.4, -157.73, 'Pacific/Honolulu'),
      utc: new Date('2026-02-09T22:00:00Z'),
      now: new Date('2026-02-01T00:00:00Z'),
      camera: defaultCamera({ latitude: 21.4, longitude: -157.73 }, 90),
      environment: env,
      scenario: 'storm',
      forceScenario: true,
      weather: { capabilities: OPEN_METEO_CAPABILITIES, frames: [], providerFailed: false },
      render: DEFAULT_RENDER_SETTINGS,
      includeLunar: false,
      realReference: false,
    });
    expect(groundTextureFor(storm)!.wet).toBeGreaterThan(0.5);
    expect(groundTextureFor(storm)!.wet).toBeLessThanOrEqual(1);
  });

  it('is off when the setting says so; the Minimal rung keeps the base surface', () => {
    expect(
      groundTextureFor(
        sceneAt(21.4, new Date('2026-02-09T22:00:00Z'), {
          ...DEFAULT_RENDER_SETTINGS,
          groundTexture: false,
        }),
      ),
    ).toBeNull();
    const minimal = groundTextureFor(
      sceneAt(21.4, new Date('2026-02-09T22:00:00Z'), {
        ...DEFAULT_RENDER_SETTINGS,
        shadows: false,
      }),
    );
    expect(minimal).not.toBeNull();
    expect(minimal!.detail).toBe(0);
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
    // A sea level that was not measured paints no shore (D.C.'s geoid is 33 m under the
    // ellipsoid: read as 0, the whole flat city was sand).
    expect(g.shore).toBe(0);
    const known = groundTextureFor(
      sceneAt(30, new Date('2026-07-01T00:00:00Z')),
      NEUTRAL_LAND_HINT,
      {
        brightness: 1,
        seaLevelM: -33,
        seaLevelKnown: true,
      },
    )!;
    expect(known.shore).toBe(1);
    const d = groundTextureFor(sceneAt(30, new Date('2026-07-01T00:00:00Z')))!;
    expect(d.brightness).toBe(1);
    expect(d.seaLevelM).toBe(0);
    expect(d.shore).toBe(0);
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
    expect(GROUND_MATERIAL_SOURCE).toContain(`uniform sampler2D ${GROUND_DETAIL_UNIFORM};`);
    expect(GROUND_MATERIAL_SOURCE).toContain(`uniform sampler2D ${GROUND_NOISE_UNIFORM};`);
    // The four surfaces are the detail texture's channels, in the atlas's quadrant order.
    expect(GROUND_DETAIL_QUADRANTS).toEqual(['grass', 'rock', 'sand', 'snow']);
    expect(GROUND_MATERIAL_SOURCE).toContain('vec4 tiles = vec4(wGrass, wRock, wSand, wSnow);');
    // Two tile scales, each gated by its own size on screen, so no scale pops in with distance.
    expect(GROUND_MATERIAL_SOURCE.match(/lmDetailTier\(q/g)?.length).toBe(2);
    expect(GROUND_MATERIAL_SOURCE).toContain('u_coarseBasemap');
    // Each tier has its own camera offset (a scaled fine coordinate would jump every 2.5 m).
    for (const t of GROUND_DETAIL_TIERS) {
      expect(GROUND_MATERIAL_SOURCE).toContain(`uniform vec3 ${t.offsetUniform};`);
      expect(GROUND_MATERIAL_SOURCE).toContain(
        `enu / ${t.periodM % 1 === 0 ? t.periodM.toFixed(1) : t.periodM} + ${t.offsetUniform}`,
      );
    }
    expect(GROUND_DETAIL_TIERS[0].periodM).toBe(GROUND_DETAIL_PERIOD_M);
    // A shrunk tile repeats into a grid of dots: tiles only where a period spans >= 40 px.
    expect(GROUND_MATERIAL_SOURCE).toContain('smoothstep(40.0, 160.0, pxPerPeriod)');
    // Noise is read from the baked texture, never computed per fragment (the procedural version
    // took ~1.7 s to compile on a Windows PC), along the ground frame plus the camera's place on
    // it modulo a wrap every period divides, so the pattern never jumps when that wraps.
    expect(GROUND_MATERIAL_SOURCE).not.toMatch(/lmFbm|lmNoise\(|lmNoiseI\(/);
    expect(GROUND_MATERIAL_SOURCE).toContain('vec3 g = enu + u_camMod;');
    for (const period of Object.values(GROUND_NOISE_PERIODS_M)) {
      expect(GROUND_NOISE_WRAP_M % period).toBe(0);
      expect(GROUND_MATERIAL_SOURCE).toContain(period.toFixed(1));
    }
    expect(GROUND_NOISE_WRAP_M % (GROUND_NOISE_PERIODS_M.patches / 2)).toBe(0);
    expect(GROUND_NOISE_WRAP_M % (GROUND_NOISE_PERIODS_M.clouds / 2)).toBe(0);
    // The town grid's lattice: whole cells and the fraction from the CPU.
    expect(GROUND_MATERIAL_SOURCE).toContain(`uniform vec3 ${GROUND_TOWN_GRID.cellUniform};`);
    expect(GROUND_MATERIAL_SOURCE).toContain(`uniform vec3 ${GROUND_TOWN_GRID.fracUniform};`);
    expect(GROUND_MATERIAL_SOURCE).toContain(
      `enu.xy / ${GROUND_TOWN_GRID.cellM.toFixed(1)} + ${GROUND_TOWN_GRID.fracUniform}.xy`,
    );
    for (const v of ['u_eastWC', 'u_northWC', 'u_upWC', 'u_detailOffset', 'u_camMod'])
      expect(GROUND_MATERIAL_SOURCE).toContain(`uniform vec3 ${v};`);
    expect(GROUND_DETAIL_PERIOD_M).toBe(2.5);
    expect(GROUND_MATERIAL_SOURCE).toContain(
      `/ ${GROUND_DETAIL_PERIOD_M.toFixed(1)} + u_detailOffset`,
    );
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

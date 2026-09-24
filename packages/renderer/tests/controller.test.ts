import { describe, expect, it } from 'vitest';
import { localSelectionToUtc } from '@lightmap/astronomy';
import {
  DEFAULT_RENDER_SETTINGS,
  buildSceneState,
  defaultCamera,
  type EnvironmentState,
  type SceneInputs,
  type SceneState,
} from '@lightmap/scene';
import { OPEN_METEO_CAPABILITIES } from '@lightmap/weather';
import {
  SceneController,
  cesiumFovDeg,
  shadowReachM,
  sunPathForDay,
} from '../src/cesium/controller.ts';
import type { SceneHost } from '../src/cesium/host.ts';

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

function scene(over: Partial<SceneInputs> = {}): SceneState {
  return buildSceneState({
    location: kailua,
    utc: localSelectionToUtc({ year: 2026, month: 5, day: 31 }, 12 * 60 + 30, kailua.timeZone),
    now: new Date('2026-05-01T00:00:00Z'),
    camera: defaultCamera(kailua.point, 90),
    environment: env,
    scenario: 'clear',
    forceScenario: true,
    weather: { capabilities: OPEN_METEO_CAPABILITIES, frames: [], providerFailed: false },
    render: DEFAULT_RENDER_SETTINGS,
    includeLunar: false,
    realReference: false,
    ...over,
  });
}

function fakeHost() {
  const calls: Record<string, unknown[][]> = {};
  const rec =
    (k: string) =>
    (...a: unknown[]) => {
      (calls[k] ??= []).push(a);
    };
  const host: SceneHost = {
    setTime: rec('setTime'),
    setLight: rec('setLight'),
    setShadows: rec('setShadows'),
    setAtmosphere: rec('setAtmosphere'),
    setGrade: rec('setGrade'),
    setCamera: rec('setCamera'),
    setOverlay: rec('setOverlay'),
    setQuality: rec('setQuality'),
    setTerrain: async (...a) => {
      rec('setTerrain')(...a);
    },
    setBasemap: async (...a) => {
      rec('setBasemap')(...a);
    },
    setCelestialBodies: rec('setCelestialBodies'),
    sunScreenPosition: () => [0.5, 0.6],
    sampleGroundHeight: async () => 42,
    requestRender: rec('requestRender'),
    stats: () => ({
      fps: 60,
      terrainTilesLoaded: 0,
      terrainTilesLoading: 0,
      drawCalls: null,
      cesiumSunDirectionEcef: null,
    }),
    onPick: () => () => {},
    onFrameSample: () => () => {},
    resize: () => {},
    captureThumbnail: async () => null,
    destroy: rec('destroy'),
  };
  return { host, calls };
}

describe('SceneController', () => {
  it('applies light, grade, camera and overlay on every tick; expensive work is debounced', () => {
    const timers: Array<() => void> = [];
    const { host, calls } = fakeHost();
    const c = new SceneController(host, {
      setTimeoutImpl: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeoutImpl: () => {},
      aspect: () => 16 / 9,
    });
    c.apply(scene());
    c.apply(scene({ utc: new Date(scene().utc.getTime() + 3_600_000) }));
    expect(calls['setLight']).toHaveLength(2);
    expect(calls['setGrade']).toHaveLength(2);
    expect(calls['setTime']).toHaveLength(2);
    expect(calls['setQuality']).toBeUndefined(); // debounced, not yet flushed
    expect(timers.length).toBeGreaterThan(0);
    timers[timers.length - 1]!();
    expect(calls['setQuality']).toHaveLength(1);
    const grade = calls['setGrade']![1]![0] as { u_sunVisible: number; u_cloudOpacity: number };
    expect(grade.u_sunVisible).toBe(1);
    expect(grade.u_cloudOpacity).toBeLessThan(0.1);
  });

  it('map mode → orbit camera with fly on pin move; viewpoint mode → eye camera with aspect-corrected fov', () => {
    const { host, calls } = fakeHost();
    const c = new SceneController(host, {
      setTimeoutImpl: () => 0,
      clearTimeoutImpl: () => {},
      aspect: () => 9 / 16,
    });
    c.apply(scene());
    const first = calls['setCamera']![0]![0] as { kind: string; fly: boolean };
    expect(first).toMatchObject({ kind: 'orbit', fly: true });
    const vp = scene({ camera: { ...defaultCamera(kailua.point, 45), mode: 'viewpoint' } });
    c.apply(vp);
    const cam = calls['setCamera']!.at(-1)![0] as {
      kind: string;
      headingDeg: number;
      fovDeg: number;
    };
    expect(cam.kind).toBe('viewpoint');
    expect(cam.headingDeg).toBe(45);
    expect(cam.fovDeg).toBeGreaterThan(vp.camera.fovDeg); // portrait: vertical fov is wider than horizontal
    expect(calls['setCelestialBodies']!.at(-1)![0]).toEqual({
      sun: true,
      moon: false,
      stars: false,
    }); // noon: sun disc, no stars
    const overlay = calls['setOverlay']!.at(-1)![0] as { visible: boolean };
    expect(overlay.visible).toBe(false);
  });

  it('overlay carries the sun path, current sun and shadow azimuth in map mode', () => {
    const { host, calls } = fakeHost();
    const c = new SceneController(host, { setTimeoutImpl: () => 0, clearTimeoutImpl: () => {} });
    const s = scene();
    c.apply(s);
    const o = calls['setOverlay']![0]![0] as {
      visible: boolean;
      sunPath: unknown[];
      sun: { elevationDeg: number };
      shadowAzimuthDeg: number;
    };
    expect(o.visible).toBe(true);
    expect(o.sunPath.length).toBeGreaterThan(60);
    expect(o.sun.elevationDeg).toBeGreaterThan(89);
    expect(o.shadowAzimuthDeg).toBeCloseTo((s.solar.azimuthDegrees + 180) % 360, 6);
    expect(sunPathForDay(s).every((p) => p.elevationDeg > -1)).toBe(true);
  });

  it('shadow toggling follows direct light; provider swaps are diffed and refresh ground height', async () => {
    const { host, calls } = fakeHost();
    let t = 0;
    const c = new SceneController(host, {
      setTimeoutImpl: () => 0,
      clearTimeoutImpl: () => {},
      now: () => t,
    });
    c.apply(scene({ scenario: 'storm' }));
    expect((calls['setShadows']![0]![0] as { enabled: boolean }).enabled).toBe(false);
    c.apply(scene({ scenario: 'clear' }));
    const last = calls['setShadows']!.at(-1)![0] as { enabled: boolean; maximumDistance: number };
    expect(last.enabled).toBe(true);
    // Golden-hour shadows are never faded away; reach follows the camera mode.
    expect(last.maximumDistance).toBeGreaterThanOrEqual(8000);
    const vp = scene({ scenario: 'clear' });
    expect(shadowReachM({ ...vp, camera: { ...vp.camera, mode: 'viewpoint' } }, 500)).toBe(20_000);
    expect(shadowReachM({ ...vp, camera: { ...vp.camera, mode: 'map' } }, 500)).toBe(8_000);
    expect(shadowReachM({ ...vp, camera: { ...vp.camera, mode: 'map' } }, 10_000)).toBe(30_000);
    expect(shadowReachM({ ...vp, camera: { ...vp.camera, mode: 'map' } }, 1e6)).toBe(60_000);
    const terrain = {
      kind: 'quantized-mesh' as const,
      url: 'https://t/layer.json',
      attribution: 'x',
    };
    const basemap = { kind: 'cesium-natural-earth' as const, attribution: 'ne' };
    t = 5000; // the initial fly-to has finished
    await c.setProviders(terrain, basemap);
    await c.setProviders(terrain, basemap);
    expect(calls['setTerrain']).toHaveLength(1);
    expect(calls['setBasemap']).toHaveLength(1);
    expect(c.groundHeight).toBe(42);
    const cam = calls['setCamera']!.at(-1)![0] as { targetHeightM: number };
    expect(cam.targetHeightM).toBe(42);
    c.destroy();
    expect(calls['destroy']).toHaveLength(1);
  });

  it('reduced motion: the pin move jumps instead of flying (plan §28)', () => {
    const { host, calls } = fakeHost();
    const c = new SceneController(host, {
      setTimeoutImpl: () => 0,
      clearTimeoutImpl: () => {},
      aspect: () => 16 / 9,
    });
    const base = scene();
    c.apply({ ...base, render: { ...base.render, reducedMotion: true } });
    const first = calls['setCamera']![0]![0] as { kind: string; fly: boolean };
    expect(first).toMatchObject({ kind: 'orbit', fly: false });
  });

  it('does not cut a fly-to short: orbit updates during the flight are deferred until it ends', () => {
    const { host, calls } = fakeHost();
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let t = 0;
    const c = new SceneController(host, {
      setTimeoutImpl: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimeoutImpl: () => {},
      now: () => t,
    });
    c.apply(scene());
    expect((calls['setCamera']![0]![0] as { fly: boolean }).fly).toBe(true);
    t = 500;
    c.setOrbit({ headingDeg: 90 }); // during the flight: deferred, not applied
    expect(calls['setCamera']).toHaveLength(1);
    const retry = timers.find((x) => x.ms === 900)!; // 1400 ms flight − 500 ms elapsed (the 250 ms one is the expensive-work debounce)
    expect(retry).toBeDefined();
    t = 1500;
    retry.fn();
    expect(calls['setCamera']).toHaveLength(2);
    expect(calls['setCamera']![1]![0]).toMatchObject({ kind: 'orbit', fly: false, headingDeg: 90 });
  });

  it('cesiumFovDeg converts horizontal to vertical fov in portrait only', () => {
    expect(cesiumFovDeg(74, 16 / 9)).toBe(74);
    expect(cesiumFovDeg(74, 9 / 16)).toBeGreaterThan(100);
    expect(cesiumFovDeg(74, 1)).toBe(74);
  });
});

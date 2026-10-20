/**
 * The ground material's uniforms and its per-frame frame, shared by the Cesium host (on the
 * globe) and `tools/renderer-smoke` (on a probe rectangle, since the smoke run's ellipsoid has no
 * vertex normals and the globe does not apply a material there). One definition, so the probe
 * cannot drift from what the app draws - it had (a renamed texture function, new uniforms) and
 * the smoke run's ground probe failed before it drew.
 */
import type * as Cesium from '@cesium/engine';
import {
  GROUND_COVER_BOUNDS_UNIFORM,
  GROUND_COVER_IMAGE_UNIFORM,
  GROUND_DETAIL_TIERS,
  GROUND_DETAIL_UNIFORM,
  GROUND_NOISE_UNIFORM,
  GROUND_NOISE_WRAP_M,
  GROUND_ROAD_BOUNDS_UNIFORM,
  GROUND_ROAD_IMAGE_UNIFORM,
  GROUND_TOWN_GRID,
  GROUND_UNIFORM_DEFAULTS,
} from '../shaders/ground.frag.ts';

type C = typeof Cesium;

/**
 * Every uniform the ground material declares, at its default: the scene's values (snowline,
 * season, ...) start at `GROUND_UNIFORM_DEFAULTS`; the images (cover map, road map, detail
 * tiles, noise) at Cesium's default image until loaded; the frame and its offsets at zero.
 */
export function groundMaterialUniforms(C: C, coarseBasemap: number): Record<string, unknown> {
  return {
    ...GROUND_UNIFORM_DEFAULTS,
    [GROUND_COVER_BOUNDS_UNIFORM]: new C.Cartesian4(0, 0, 0, 0),
    [GROUND_COVER_IMAGE_UNIFORM]: C.Material.DefaultImageId,
    [GROUND_ROAD_BOUNDS_UNIFORM]: new C.Cartesian4(0, 0, 0, 0),
    [GROUND_ROAD_IMAGE_UNIFORM]: C.Material.DefaultImageId,
    [GROUND_DETAIL_UNIFORM]: C.Material.DefaultImageId,
    [GROUND_NOISE_UNIFORM]: C.Material.DefaultImageId,
    u_detailOn: 0,
    u_coarseBasemap: coarseBasemap,
    u_eastWC: new C.Cartesian3(1, 0, 0),
    u_northWC: new C.Cartesian3(0, 1, 0),
    u_upWC: new C.Cartesian3(0, 0, 1),
    ...Object.fromEntries(
      GROUND_DETAIL_TIERS.map((t) => [t.offsetUniform, new C.Cartesian3(0, 0, 0)]),
    ),
    u_camMod: new C.Cartesian3(0, 0, 0),
    [GROUND_TOWN_GRID.cellUniform]: new C.Cartesian3(0, 0, 0),
    [GROUND_TOWN_GRID.fracUniform]: new C.Cartesian3(0, 0, 0),
  };
}

/** The east/north/up frame every ground pattern is laid along, anchored at a point. */
export interface GroundFrame {
  anchor: Cesium.Cartesian3;
  east: Cesium.Cartesian3;
  north: Cesium.Cartesian3;
  up: Cesium.Cartesian3;
  anchored: boolean;
}

export function newGroundFrame(C: C): GroundFrame {
  return {
    anchor: new C.Cartesian3(),
    east: new C.Cartesian3(1, 0, 0),
    north: new C.Cartesian3(0, 1, 0),
    up: new C.Cartesian3(0, 0, 1),
    anchored: false,
  };
}

/**
 * Anchors the frame at a point on the ground (east along the parallel, up the surface normal)
 * and gives its axes to the material. False when the point has no frame (a pole, the centre).
 */
export function anchorGroundFrame(
  C: C,
  frame: GroundFrame,
  at: Cesium.Cartesian3,
  u: Record<string, unknown>,
): boolean {
  const { east, north, up } = frame;
  const n = C.Ellipsoid.WGS84.geodeticSurfaceNormal(at, up);
  const h = Math.hypot(at.x, at.y);
  if (!n || h < 1) return false;
  east.x = -at.y / h;
  east.y = at.x / h;
  east.z = 0;
  C.Cartesian3.cross(up, east, north);
  C.Cartesian3.clone(at, frame.anchor);
  frame.anchored = true;
  C.Cartesian3.clone(east, u['u_eastWC'] as Cesium.Cartesian3);
  C.Cartesian3.clone(north, u['u_northWC'] as Cesium.Cartesian3);
  C.Cartesian3.clone(up, u['u_upWC'] as Cesium.Cartesian3);
  return true;
}

/**
 * The camera's place along the anchored frame, as the shader takes it each frame: modulo the
 * noise's wrap, as fractions of each detail tier's period and of the town grid's cell - all in
 * double here, so the patterns stay fixed to the ground however far the camera is from the
 * frame's origin.
 */
export function updateGroundOffsets(
  C: C,
  frame: GroundFrame,
  cam: Cesium.Cartesian3,
  u: Record<string, unknown>,
): void {
  if (!frame.anchored) return;
  const f = (v: number) => v - Math.floor(v);
  const ce = C.Cartesian3.dot(cam, frame.east);
  const cn = C.Cartesian3.dot(cam, frame.north);
  const cu = C.Cartesian3.dot(cam, frame.up);
  const wrap = (v: number) => v - Math.floor(v / GROUND_NOISE_WRAP_M) * GROUND_NOISE_WRAP_M;
  const camMod = u['u_camMod'] as Cesium.Cartesian3;
  camMod.x = wrap(ce);
  camMod.y = wrap(cn);
  camMod.z = wrap(cu);
  for (const tier of GROUND_DETAIL_TIERS) {
    const off = u[tier.offsetUniform] as Cesium.Cartesian3;
    off.x = f(ce / tier.periodM);
    off.y = f(cn / tier.periodM);
    off.z = f(cu / tier.periodM);
  }
  const cellU = u[GROUND_TOWN_GRID.cellUniform] as Cesium.Cartesian3;
  const fracU = u[GROUND_TOWN_GRID.fracUniform] as Cesium.Cartesian3;
  const x = ce / GROUND_TOWN_GRID.cellM;
  const y = cn / GROUND_TOWN_GRID.cellM;
  const z = cu / GROUND_TOWN_GRID.cellM;
  cellU.x = Math.floor(x);
  cellU.y = Math.floor(y);
  cellU.z = Math.floor(z);
  fracU.x = x - cellU.x;
  fracU.y = y - cellU.y;
  fracU.z = z - cellU.z;
}

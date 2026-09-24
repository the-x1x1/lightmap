/**
 * Click → coordinate. Prefers a depth-buffer pick on terrain (`scene.pickPosition`) and falls back
 * to the ellipsoid when depth picking is unsupported or misses (sky).
 *
 * Provenance: the resolution order and the Cartographic conversion are ported from the owner's
 * WorldView repository (`render-cesium/src/renderer.ts#surfacePosition`, `picking.ts`),
 * owner-authored, MIT; feature/entity picking removed. See docs/WORLDVIEW_REUSE_AUDIT.md row 3.
 */
import type { GeoPoint } from '@lightmap/geospatial';

export interface Cartographic {
  /** radians */
  latitude: number;
  longitude: number;
  height: number;
}

export interface Cartesian3Like {
  x: number;
  y: number;
  z: number;
}

/** The narrow slice of Cesium the picker needs, so it can be tested with plain objects. */
export interface PickSurfaceLike {
  pickPositionSupported: boolean;
  pickPosition(windowPosition: { x: number; y: number }): Cartesian3Like | undefined;
  pickEllipsoid(windowPosition: { x: number; y: number }): Cartesian3Like | undefined;
  toCartographic(cartesian: Cartesian3Like): Cartographic | undefined;
}

const RAD = 180 / Math.PI;

export function pickSurface(
  scene: PickSurfaceLike,
  windowPosition: { x: number; y: number },
): (GeoPoint & { viaTerrain: boolean }) | null {
  let cartesian: Cartesian3Like | undefined;
  let viaTerrain = false;
  if (scene.pickPositionSupported) {
    cartesian = scene.pickPosition(windowPosition);
    viaTerrain = cartesian !== undefined;
  }
  cartesian ??= scene.pickEllipsoid(windowPosition);
  if (!cartesian) return null;
  const carto = scene.toCartographic(cartesian);
  if (!carto) return null;
  const point: GeoPoint & { viaTerrain: boolean } = {
    latitude: carto.latitude * RAD,
    longitude: carto.longitude * RAD,
    viaTerrain,
  };
  if (viaTerrain && Number.isFinite(carto.height)) point.elevationM = carto.height;
  return point;
}

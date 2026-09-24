/**
 * Camera altitude ↔ web-mercator zoom, heading normalisation and framing math.
 *
 * Provenance: ported from the owner's WorldView repository — `render-cesium/src/view.ts`
 * (`normalizeHeadingDegrees`, `altitudeForBounds`) and `render-core/src/contract.ts`
 * (`zoomToAltitudeM`, `altitudeToZoom`), owner-authored, MIT — and rewritten against LightMap's
 * `CameraState`. See docs/WORLDVIEW_REUSE_AUDIT.md row 2.
 */
import type { GeoBounds } from '@lightmap/geospatial';

const DEG = Math.PI / 180;
/** Web-Mercator metres per pixel at zoom 0 for 256 px tiles. */
const MPP_Z0 = 156_543.033_92;
/** Half of a ~60° vertical field of view; the framing assumption both conversions share. */
const HALF_FOV_TAN = Math.tan(Math.PI / 6);

export function normalizeHeadingDegrees(h: number): number {
  const x = h % 360;
  return x < 0 ? x + 360 : x;
}

/** Camera height above the ellipsoid that shows the same ground extent as a 2D map at `zoom`. */
export function zoomToAltitudeM(zoom: number, latitude = 0, viewportPx = 1024): number {
  const metersPerPixel = (MPP_Z0 * Math.cos(latitude * DEG)) / Math.pow(2, zoom);
  return Math.max(10, (metersPerPixel * (viewportPx / 2)) / HALF_FOV_TAN);
}

export function altitudeToZoom(altitudeM: number, latitude = 0, viewportPx = 1024): number {
  const metersPerPixel = (altitudeM * HALF_FOV_TAN) / (viewportPx / 2);
  const z = Math.log2((MPP_Z0 * Math.cos(latitude * DEG)) / metersPerPixel);
  return Math.max(0, Math.min(22, z));
}

/** Camera altitude that frames `bounds` in a ~60° FOV viewport (square worst case, 15 % margin). */
export function altitudeForBounds(bounds: GeoBounds, minAltitudeM = 500): number {
  const latSpanM = Math.abs(bounds.north - bounds.south) * 111_320;
  const midLat = (bounds.north + bounds.south) / 2;
  const lonSpan =
    bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
  const lonSpanM = lonSpan * 111_320 * Math.cos(midLat * DEG);
  const halfSpan = Math.max(latSpanM, lonSpanM) / 2;
  return Math.max(minAltitudeM, (halfSpan / HALF_FOV_TAN) * 1.15);
}

/**
 * Orbit camera for "map" mode: look at the pin from a distance, tilted. Returns the Cesium
 * `lookAt` offset as heading/pitch/range so the pin stays centred while the user orbits.
 */
export interface OrbitView {
  headingDeg: number;
  /** Negative looks down. */
  pitchDeg: number;
  rangeM: number;
}

export function defaultOrbit(rangeM = 1500): OrbitView {
  return { headingDeg: 0, pitchDeg: -35, rangeM };
}

export function clampOrbit(v: OrbitView, minRange = 50, maxRange = 5_000_000): OrbitView {
  return {
    headingDeg: normalizeHeadingDegrees(v.headingDeg),
    pitchDeg: Math.max(-89, Math.min(-5, v.pitchDeg)),
    rangeM: Math.max(minRange, Math.min(maxRange, v.rangeM)),
  };
}

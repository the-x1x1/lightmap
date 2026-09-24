/**
 * WGS84 helpers. Degrees everywhere; longitudes normalised to [-180, 180].
 *
 * Provenance: `normalizeLongitude`, `isValidLatLon`, `haversineMeters`, `bearingDegrees` and
 * `clampBounds` were ported from the owner's WorldView repository
 * (`packages/world-model/src/geo.ts`, owner-authored, MIT) and reduced to what LightMap needs.
 * See docs/WORLDVIEW_REUSE_AUDIT.md row 1.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
  /** Metres above mean sea level when known. */
  elevationM?: number;
}

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

export function normalizeLongitude(lon: number): number {
  if (!Number.isFinite(lon)) return lon;
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  if (x === -180 && lon > 0) x = 180;
  return x;
}

export function isValidLatLon(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/** Great-circle distance in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.latitude - a.latitude) * DEG;
  const dLon = (b.longitude - a.longitude) * DEG;
  const la1 = a.latitude * DEG;
  const la2 = b.latitude * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north in [0, 360). */
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const la1 = a.latitude * DEG;
  const la2 = b.latitude * DEG;
  const dLon = (b.longitude - a.longitude) * DEG;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return normalizeDegrees(Math.atan2(y, x) / DEG);
}

/** Wrap any angle into [0, 360). */
export function normalizeDegrees(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

export function clampBounds(b: GeoBounds): GeoBounds {
  return {
    west: Math.max(-180, Math.min(180, b.west)),
    south: Math.max(-90, Math.min(90, b.south)),
    east: Math.max(-180, Math.min(180, b.east)),
    north: Math.max(-90, Math.min(90, b.north)),
  };
}

/**
 * Quantise a coordinate to a grid cell for cache keys (plan §19). 0.05° ≈ 5.5 km at the equator:
 * weather models are coarser than that, so two pins in the same cell share one forecast fetch.
 */
export function gridKey(p: GeoPoint, cellDeg = 0.05): string {
  const q = (v: number) => (Math.round(v / cellDeg) * cellDeg).toFixed(4);
  return `${q(p.latitude)},${q(normalizeLongitude(p.longitude))}`;
}

/** Compass label for a bearing, 16-point ("SSE"). */
export function compassLabel(bearing: number, points: 8 | 16 = 16): string {
  const names16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const names8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const names = points === 16 ? names16 : names8;
  const step = 360 / names.length;
  const idx = Math.round(normalizeDegrees(bearing) / step) % names.length;
  return names[idx] ?? 'N';
}

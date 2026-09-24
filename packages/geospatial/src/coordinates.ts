/**
 * Parse user-pasted coordinates. Search is only for finding a known place or coordinate (plan
 * §0); pasting "21.397, -157.727", "21°23'49\"N 157°43'37\"W", "21.397 N 157.727 W" or a Google
 * Maps `@lat,lng,z` fragment must all land the pin without a network call.
 */
import { isValidLatLon, normalizeLongitude, type GeoPoint } from './geo.ts';

const DMS = /(-?\d+(?:\.\d+)?)\s*[°º:\s]\s*(\d+(?:\.\d+)?)?\s*['′:\s]?\s*(\d+(?:\.\d+)?)?\s*["″]?\s*([NSEW])?/i;

function dmsToDecimal(m: RegExpMatchArray): number | null {
  const deg = Number(m[1]);
  const min = m[2] !== undefined ? Number(m[2]) : 0;
  const sec = m[3] !== undefined ? Number(m[3]) : 0;
  if (![deg, min, sec].every(Number.isFinite)) return null;
  const sign = deg < 0 ? -1 : 1;
  let v = Math.abs(deg) + min / 60 + sec / 3600;
  v *= sign;
  const hemi = m[4]?.toUpperCase();
  if (hemi === 'S' || hemi === 'W') v = -Math.abs(v);
  if (hemi === 'N' || hemi === 'E') v = Math.abs(v);
  return v;
}

export function parseCoordinates(input: string): GeoPoint | null {
  const text = input.trim();
  if (text.length === 0) return null;

  // Google Maps URL fragment: .../@21.397,-157.727,15z
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(text);
  if (at) {
    const lat = Number(at[1]);
    const lon = Number(at[2]);
    return isValidLatLon(lat, lon) ? { latitude: lat, longitude: lon } : null;
  }

  // Plain decimal pair, comma or whitespace separated, optional hemisphere letters.
  const dec = /^(-?\d+(?:\.\d+)?)\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*([EW])?$/i.exec(text);
  if (dec) {
    let lat = Number(dec[1]);
    let lon = Number(dec[3]);
    if (dec[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
    if (dec[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
    if (lon > 180 || lon < -180) lon = normalizeLongitude(lon);
    return isValidLatLon(lat, lon) ? { latitude: lat, longitude: lon } : null;
  }

  // DMS pair.
  const parts = text.split(/[,;]|\s{2,}|(?<=[NSns])\s+(?=[-\d])/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2) {
    const a = DMS.exec(parts[0] ?? '');
    const b = DMS.exec(parts[1] ?? '');
    if (a && b) {
      const lat = dmsToDecimal(a);
      const lon = dmsToDecimal(b);
      if (lat !== null && lon !== null && isValidLatLon(lat, lon)) return { latitude: lat, longitude: lon };
    }
  }
  return null;
}

/** "21.3970° N, 157.7270° W" */
export function formatCoordinates(p: GeoPoint, decimals = 4): string {
  const lat = `${Math.abs(p.latitude).toFixed(decimals)}° ${p.latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(p.longitude).toFixed(decimals)}° ${p.longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

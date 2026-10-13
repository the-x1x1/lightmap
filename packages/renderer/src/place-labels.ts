/**
 * Place labels on the globe: country names from orbit, then capitals and cities, then towns as
 * the camera closes in — so the map has its bearings at every zoom. The data is bundled
 * (`apps/web/public/data/place-labels.json`, Natural Earth, public domain; `pnpm labels:places`).
 *
 * The pure parts live here (parsing, how far away each label shows, the horizon test); the Cesium
 * host draws them. Labels are drawn without the depth test (terrain would swallow a label at sea
 * level under a mountain town), so the host hides those behind the Earth itself with
 * `aboveHorizon`, an exact test for points on the ellipsoid.
 */
import type { Vec3 } from './sun-vector.ts';

export interface PlaceLabel {
  name: string;
  latitude: number;
  longitude: number;
  /** Natural Earth's min_zoom: the web map zoom from which a cartographer labels it. */
  minZoom: number;
  capital: boolean;
}

export interface CountryLabel {
  name: string;
  latitude: number;
  longitude: number;
  /** Natural Earth's MIN_LABEL: the zoom from which the country is labelled. */
  minLabel: number;
}

export interface PlaceLabelSet {
  places: PlaceLabel[];
  countries: CountryLabel[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parse the bundled file; rows that do not fit the shape are skipped, never thrown on. */
export function parsePlaceLabels(json: unknown): PlaceLabelSet {
  const out: PlaceLabelSet = { places: [], countries: [] };
  if (!json || typeof json !== 'object') return out;
  const o = json as { places?: unknown; countries?: unknown };
  if (Array.isArray(o.places))
    for (const r of o.places) {
      if (!Array.isArray(r)) continue;
      const [name, lat, lon, z, cap] = r as unknown[];
      if (typeof name !== 'string' || !isNum(lat) || !isNum(lon) || !isNum(z)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      out.places.push({ name, latitude: lat, longitude: lon, minZoom: z, capital: cap === 1 });
    }
  if (Array.isArray(o.countries))
    for (const r of o.countries) {
      if (!Array.isArray(r)) continue;
      const [name, lat, lon, min] = r as unknown[];
      if (typeof name !== 'string' || !isNum(lat) || !isNum(lon) || !isNum(min)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      out.countries.push({ name, latitude: lat, longitude: lon, minLabel: min });
    }
  return out;
}

/**
 * Camera distance (metres) from which a web-map zoom level's labels show. A web map at zoom z
 * frames about 40 000 km / 2^z of ground; the camera that frames as much from straight above,
 * with the globe's 60° field of view, stands about two thirds of that away.
 */
export function zoomToDistanceM(zoom: number): number {
  return 2.6e7 / 2 ** zoom;
}

/** How far away a place's label still shows: its zoom's distance, capitals a little further. */
export function placeMaxDistanceM(p: Pick<PlaceLabel, 'minZoom' | 'capital'>): number {
  return zoomToDistanceM(p.minZoom) * (p.capital ? 1.6 : 1);
}

/**
 * The band in which a country's name shows: from its labelling zoom's distance (capped at
 * a whole-globe view) in to 600 km, where its towns have taken over.
 */
export function countryDistanceBandM(c: Pick<CountryLabel, 'minLabel'>): [number, number] {
  return [6e5, Math.min(4e7, zoomToDistanceM(c.minLabel - 1.5))];
}

const WGS84_A = 6378137;
const WGS84_B = 6356752.314245;

/**
 * Whether a point on the ellipsoid's surface faces a camera at `camera` (ECEF metres): exact,
 * in the space where the ellipsoid is the unit sphere (a surface point p is visible from c when
 * p·c > 1 there). The margin must stay tiny: a camera 3 km up sees ground at p·c ≈ 1.0005, so a
 * margin of a few thousandths would hide every label once the camera is near the ground.
 */
export function aboveHorizon(point: Vec3, camera: Vec3, margin = 1e-6): boolean {
  const a2 = WGS84_A * WGS84_A;
  const b2 = WGS84_B * WGS84_B;
  return (point.x * camera.x + point.y * camera.y) / a2 + (point.z * camera.z) / b2 > 1 + margin;
}

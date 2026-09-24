/**
 * Nominatim (OpenStreetMap) geocoder — DEVELOPMENT ONLY.
 *
 * The public Nominatim usage policy (operations.osmfoundation.org/policies/nominatim) allows at
 * most one request per second, requires an identifying User-Agent, forbids autocomplete-style
 * bursts and disallows heavy/commercial use. `meta.review` is therefore `development-only`; env
 * validation warns in production and docs/DATA_SOURCES_AND_LICENSING.md lists the replacement
 * options (a contracted geocoder behind this same interface).
 *
 * The adapter is server-side only (it needs the User-Agent header), rate-limited to 1 req/s
 * per process, and results are cached by normalised query (plan §19).
 */
import { isValidLatLon, type GeoPoint } from '../geo.ts';
import type { GeocodingProvider, Place, ProviderMeta } from './types.ts';

export const NOMINATIM_META: ProviderMeta = {
  id: 'nominatim',
  name: 'Nominatim (OpenStreetMap)',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  license: 'ODbL 1.0 (data); usage policy limits to light, non-commercial use',
  termsUrl: 'https://operations.osmfoundation.org/policies/nominatim/',
  review: 'development-only',
  isFixture: false,
  cache: { allowed: true, maxAgeSeconds: 60 * 60 * 24 * 7 },
};

export interface NominatimOptions {
  baseUrl?: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
  /** Injected clock for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface NominatimResult {
  place_id?: number;
  display_name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string];
  address?: { country_code?: string };
}

export class NominatimGeocoder implements GeocodingProvider {
  readonly meta = NOMINATIM_META;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastRequestAt = 0;

  constructor(opts: NominatimOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
    this.userAgent = opts.userAgent;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async search(query: string, opts?: { limit?: number; signal?: AbortSignal }): Promise<Place[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(Math.min(opts?.limit ?? 5, 10)));
    url.searchParams.set('addressdetails', '1');
    const data = await this.request<NominatimResult[]>(url, opts?.signal);
    return (Array.isArray(data) ? data : []).map(toPlace).filter((p): p is Place => p !== null);
  }

  async reverse(point: GeoPoint, opts?: { signal?: AbortSignal }): Promise<Place | null> {
    const url = new URL(`${this.baseUrl}/reverse`);
    url.searchParams.set('lat', point.latitude.toFixed(6));
    url.searchParams.set('lon', point.longitude.toFixed(6));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('zoom', '14');
    const data = await this.request<NominatimResult>(url, opts?.signal);
    return data && typeof data === 'object' ? toPlace(data) : null;
  }

  private async request<T>(url: URL, signal?: AbortSignal): Promise<T> {
    // Policy: max 1 request/second.
    const wait = this.lastRequestAt + 1000 - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
    const init: RequestInit = { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } };
    if (signal !== undefined) init.signal = signal;
    const res = await this.fetchImpl(url, init);
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return (await res.json()) as T;
  }
}

function toPlace(r: NominatimResult): Place | null {
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!isValidLatLon(lat, lon) || !r.display_name) return null;
  const place: Place = { label: r.display_name, point: { latitude: lat, longitude: lon } };
  if (r.address?.country_code) place.countryCode = r.address.country_code.toUpperCase();
  if (r.place_id !== undefined) place.sourceId = `nominatim:${r.place_id}`;
  if (r.boundingbox && r.boundingbox.length === 4) {
    const [s, n, w, e] = r.boundingbox.map(Number);
    if ([s, n, w, e].every(Number.isFinite)) place.bounds = { south: s!, north: n!, west: w!, east: e! };
  }
  return place;
}

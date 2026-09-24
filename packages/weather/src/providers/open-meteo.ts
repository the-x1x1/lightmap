/**
 * Open-Meteo adapter (api.open-meteo.com).
 *
 * Licence: the free tier is for NON-COMMERCIAL use (CC BY 4.0 on the data, attribution required);
 * commercial applications need an Open-Meteo API subscription, which uses `customer-api.open-meteo.com`
 * and an `apikey` parameter. `meta.commercialReview` is `conditional` until a subscription is
 * active — env validation warns in production without `OPEN_METEO_API_KEY`.
 *
 * Forecast horizon: up to 16 days hourly. LightMap treats ≤ 7 days as reliable and 8–16 as
 * "extended, low confidence" (docs/WEATHER_AND_FORECAST_MODEL.md). Archive: recent past via
 * `past_days` up to 92 days.
 */
import type { WeatherCapabilities, WeatherFrame, WeatherProvider, WeatherSeries } from '../model.ts';

export const OPEN_METEO_CAPABILITIES: WeatherCapabilities = {
  providerId: 'open-meteo',
  maxHorizonHours: 16 * 24,
  reliableHorizonHours: 7 * 24,
  historicalDays: 92,
  hasCloudLayers: true,
  hasIrradiance: true,
  hasVisibility: true,
  updateIntervalMinutes: 60,
  isFixture: false,
  attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
  license: 'CC BY 4.0 (non-commercial free tier); commercial use requires an API subscription',
  commercialReview: 'conditional',
};

const HOURLY_FIELDS = [
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'precipitation_probability',
  'precipitation',
  'relative_humidity_2m',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'weather_code',
  'direct_normal_irradiance',
  'diffuse_radiation',
  'shortwave_radiation',
] as const;

interface OpenMeteoResponse {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  timezone?: string;
  hourly?: Partial<Record<(typeof HOURLY_FIELDS)[number] | 'time', Array<number | string | null>>>;
  error?: boolean;
  reason?: string;
}

export interface OpenMeteoOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class OpenMeteoProvider implements WeatherProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(opts: OpenMeteoOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? (opts.apiKey ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com')).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => new Date());
  }

  getCapabilities(): WeatherCapabilities {
    return { ...OPEN_METEO_CAPABILITIES, commercialReview: this.apiKey ? 'approved' : 'conditional' };
  }

  async getForecast(lat: number, lng: number, from: Date, to: Date, opts?: { signal?: AbortSignal }): Promise<WeatherSeries> {
    const url = new URL(`${this.baseUrl}/v1/forecast`);
    url.searchParams.set('latitude', lat.toFixed(4));
    url.searchParams.set('longitude', lng.toFixed(4));
    url.searchParams.set('hourly', HOURLY_FIELDS.join(','));
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('timeformat', 'iso8601');
    url.searchParams.set('wind_speed_unit', 'ms');
    url.searchParams.set('start_date', isoDate(from));
    url.searchParams.set('end_date', isoDate(to));
    if (this.apiKey) url.searchParams.set('apikey', this.apiKey);
    return this.request(url, lat, lng, opts?.signal);
  }

  async getHistorical(lat: number, lng: number, from: Date, to: Date, opts?: { signal?: AbortSignal }): Promise<WeatherSeries> {
    // The forecast endpoint serves the recent past (up to 92 days) with the same schema.
    return this.getForecast(lat, lng, from, to, opts);
  }

  private async request(url: URL, lat: number, lng: number, signal?: AbortSignal): Promise<WeatherSeries> {
    const init: RequestInit = { headers: { Accept: 'application/json' } };
    if (signal !== undefined) init.signal = signal;
    const res = await this.fetchImpl(url, init);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const body = (await res.json()) as OpenMeteoResponse;
    if (body.error) throw new Error(`Open-Meteo: ${body.reason ?? 'error'}`);
    return normalizeOpenMeteo(body, lat, lng, this.now(), this.getCapabilities());
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Vendor → normalised frames. Exported for tests and for replaying recorded fixtures. */
export function normalizeOpenMeteo(body: OpenMeteoResponse, lat: number, lng: number, fetchedAt: Date, caps: WeatherCapabilities): WeatherSeries {
  const h = body.hourly ?? {};
  const times = (h.time ?? []) as string[];
  const frames: WeatherFrame[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (typeof t !== 'string') continue;
    const iso = t.endsWith('Z') ? t : `${t}:00Z`.replace(/:00:00Z$/, ':00Z');
    const total = num(h.cloud_cover?.[i]);
    if (total === null) continue; // a frame without cloud cover is useless to the lighting model
    frames.push({
      timestamp: new Date(iso).toISOString(),
      cloudCoverTotal: Math.max(0, Math.min(100, total)),
      cloudCoverLow: num(h.cloud_cover_low?.[i]),
      cloudCoverMid: num(h.cloud_cover_mid?.[i]),
      cloudCoverHigh: num(h.cloud_cover_high?.[i]),
      precipitationProbability: num(h.precipitation_probability?.[i]),
      precipitationAmount: num(h.precipitation?.[i]),
      humidity: num(h.relative_humidity_2m?.[i]),
      visibility: num(h.visibility?.[i]),
      windSpeed: num(h.wind_speed_10m?.[i]),
      windDirection: num(h.wind_direction_10m?.[i]),
      weatherCode: num(h.weather_code?.[i]),
      directNormalIrradiance: num(h.direct_normal_irradiance?.[i]),
      diffuseRadiation: num(h.diffuse_radiation?.[i]),
      shortwaveRadiation: num(h.shortwave_radiation?.[i]),
    });
  }
  return {
    providerId: caps.providerId,
    latitude: body.latitude ?? lat,
    longitude: body.longitude ?? lng,
    modelElevationM: typeof body.elevation === 'number' ? body.elevation : null,
    timeZone: body.timezone && body.timezone !== 'GMT' ? body.timezone : null,
    frames,
    issuedAt: fetchedAt.toISOString(),
    fetchedAt: fetchedAt.toISOString(),
    capabilities: caps,
  };
}

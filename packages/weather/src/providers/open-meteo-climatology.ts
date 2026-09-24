/**
 * Open-Meteo historical archive as a ClimatologyProvider (archive-api.open-meteo.com).
 *
 * Data: ERA5 / ERA5-Land reanalysis (Copernicus Climate Change Service) served by Open-Meteo,
 * hourly, 1940 → ~5 days ago, ~9–11 km grid. Licence as for the forecast API: CC BY 4.0 on the
 * free tier (non-commercial), API subscription for commercial use (`customer-archive-api`). Storing
 * derived statistics (our monthly shares) is permitted under CC BY 4.0 with attribution; the
 * summary carries `attribution` and `license` so the UI and DATA_SOURCES_AND_LICENSING.md agree.
 *
 * One request per (year, month): a 31-day month is 744 hourly rows (~30 KB); ten years → ten
 * requests, cached for 30 days per 0.5° cell by the API route. Reanalysis is a model estimate of the
 * past, not observations at the pin — the UI says "typical", never "it was".
 */
import type {
  ClimatologyCapabilities,
  ClimatologyHour,
  ClimatologyProvider,
} from '../climatology.ts';

export const OPEN_METEO_CLIMATOLOGY_CAPABILITIES: ClimatologyCapabilities = {
  providerId: 'open-meteo-era5',
  earliestYear: 1940,
  defaultYears: 10,
  isFixture: false,
  attribution:
    'Climatology from ERA5 reanalysis (Copernicus Climate Change Service) via Open-Meteo.com (CC BY 4.0)',
  license:
    'CC BY 4.0 (non-commercial free tier); commercial use requires an Open-Meteo API subscription',
  commercialReview: 'conditional',
};

interface ArchiveResponse {
  hourly?: {
    time?: string[];
    cloud_cover?: Array<number | null>;
    precipitation?: Array<number | null>;
  };
  error?: boolean;
  reason?: string;
}

export interface OpenMeteoClimatologyOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export class OpenMeteoClimatologyProvider implements ClimatologyProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenMeteoClimatologyOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (
      opts.baseUrl ??
      (opts.apiKey
        ? 'https://customer-archive-api.open-meteo.com'
        : 'https://archive-api.open-meteo.com')
    ).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  getCapabilities(): ClimatologyCapabilities {
    return {
      ...OPEN_METEO_CLIMATOLOGY_CAPABILITIES,
      commercialReview: this.apiKey ? 'approved' : 'conditional',
    };
  }

  async getMonthHours(
    lat: number,
    lng: number,
    year: number,
    month: number,
    opts?: { signal?: AbortSignal },
  ): Promise<ClimatologyHour[]> {
    const mm = String(month).padStart(2, '0');
    const url = new URL(`${this.baseUrl}/v1/archive`);
    url.searchParams.set('latitude', lat.toFixed(3));
    url.searchParams.set('longitude', lng.toFixed(3));
    url.searchParams.set('start_date', `${year}-${mm}-01`);
    url.searchParams.set(
      'end_date',
      `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}`,
    );
    url.searchParams.set('hourly', 'cloud_cover,precipitation');
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('timeformat', 'iso8601');
    if (this.apiKey) url.searchParams.set('apikey', this.apiKey);
    const init: RequestInit = { headers: { Accept: 'application/json' } };
    if (opts?.signal) init.signal = opts.signal;
    const res = await this.fetchImpl(url, init);
    if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}`);
    const body = (await res.json()) as ArchiveResponse;
    if (body.error) throw new Error(`Open-Meteo archive: ${body.reason ?? 'error'}`);
    return normalizeArchive(body);
  }
}

/** Vendor → ClimatologyHour[]; exported for tests and recorded fixtures. */
export function normalizeArchive(body: ArchiveResponse): ClimatologyHour[] {
  const h = body.hourly ?? {};
  const times = h.time ?? [];
  const out: ClimatologyHour[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const cc = h.cloud_cover?.[i];
    if (typeof t !== 'string' || typeof cc !== 'number' || !Number.isFinite(cc)) continue;
    const iso = t.endsWith('Z') ? t : `${t}:00Z`.replace(/:00:00Z$/, ':00Z');
    const p = h.precipitation?.[i];
    out.push({
      timestamp: new Date(iso).toISOString(),
      cloudCoverTotal: Math.max(0, Math.min(100, cc)),
      precipitationAmount: typeof p === 'number' && Number.isFinite(p) ? p : null,
    });
  }
  return out;
}

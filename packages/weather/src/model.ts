/**
 * Normalised weather model (plan §9). Every vendor response is converted into `WeatherFrame`s;
 * nothing downstream knows which vendor produced them.
 */

export interface WeatherFrame {
  /** UTC ISO instant the frame is valid for (hourly frames: the start of the hour). */
  timestamp: string;
  /** 0–100 %. */
  cloudCoverTotal: number;
  cloudCoverLow: number | null;
  cloudCoverMid: number | null;
  cloudCoverHigh: number | null;
  /** 0–100 %. */
  precipitationProbability: number | null;
  /** mm over the frame's hour. */
  precipitationAmount: number | null;
  /** 0–100 %. */
  humidity: number | null;
  /** metres. */
  visibility: number | null;
  /** m/s. */
  windSpeed: number | null;
  /** degrees, direction the wind comes from. */
  windDirection: number | null;
  /** WMO 4677 weather interpretation code, as Open-Meteo and most models expose it. */
  weatherCode: number | null;
  /** W/m². */
  directNormalIrradiance?: number | null;
  diffuseRadiation?: number | null;
  shortwaveRadiation?: number | null;
}

export interface WeatherCapabilities {
  providerId: string;
  /** Hours from "now" the provider will return any forecast at all. */
  maxHorizonHours: number;
  /** Hours from "now" within which the provider's forecast is considered reliable for planning. */
  reliableHorizonHours: number;
  /** Hours after "now" (negative) the provider serves recent-past frames from its archive. */
  historicalDays: number;
  hasCloudLayers: boolean;
  hasIrradiance: boolean;
  hasVisibility: boolean;
  /** Provider forecast model update cadence, for cache TTL. */
  updateIntervalMinutes: number;
  isFixture: boolean;
  attribution: string;
  license: string;
  commercialReview: 'approved' | 'conditional' | 'development-only' | 'blocked';
}

export interface WeatherSeries {
  providerId: string;
  /** Requested location (quantised to the cache grid). */
  latitude: number;
  longitude: number;
  /** Elevation the model used, metres, when reported. */
  modelElevationM: number | null;
  /** IANA zone the provider reports for the point, when it does. */
  timeZone: string | null;
  frames: WeatherFrame[];
  /** When the provider generated the forecast (UTC ISO). */
  issuedAt: string;
  /** When LightMap fetched it (UTC ISO). */
  fetchedAt: string;
  capabilities: WeatherCapabilities;
}

export interface WeatherProvider {
  getCapabilities(): WeatherCapabilities;
  getForecast(lat: number, lng: number, from: Date, to: Date, opts?: { signal?: AbortSignal }): Promise<WeatherSeries>;
  getHistorical(lat: number, lng: number, from: Date, to: Date, opts?: { signal?: AbortSignal }): Promise<WeatherSeries>;
  /** Phase 7. Not implemented by v0.1 providers; the method exists so the interface is stable. */
  getClimatology?(lat: number, lng: number, month: number): Promise<unknown>;
}

/** Linear interpolation between the two frames bracketing `at`; null fields interpolate as null. */
export function interpolateFrame(frames: readonly WeatherFrame[], at: Date): WeatherFrame | null {
  if (frames.length === 0) return null;
  const t = at.getTime();
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (t <= Date.parse(first.timestamp)) return first;
  if (t >= Date.parse(last.timestamp)) return last;
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(frames[mid]!.timestamp) <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo]!;
  const b = frames[hi]!;
  const ta = Date.parse(a.timestamp);
  const tb = Date.parse(b.timestamp);
  const f = tb === ta ? 0 : (t - ta) / (tb - ta);
  const mix = (x: number | null | undefined, y: number | null | undefined): number | null =>
    x === null || x === undefined || y === null || y === undefined ? (x ?? y ?? null) : x + (y - x) * f;
  const mixAngle = (x: number | null, y: number | null): number | null => {
    if (x === null || y === null) return x ?? y;
    let d = ((y - x + 540) % 360) - 180;
    if (d < -180) d += 360;
    return (x + d * f + 360) % 360;
  };
  return {
    timestamp: new Date(t).toISOString(),
    cloudCoverTotal: mix(a.cloudCoverTotal, b.cloudCoverTotal) ?? a.cloudCoverTotal,
    cloudCoverLow: mix(a.cloudCoverLow, b.cloudCoverLow),
    cloudCoverMid: mix(a.cloudCoverMid, b.cloudCoverMid),
    cloudCoverHigh: mix(a.cloudCoverHigh, b.cloudCoverHigh),
    precipitationProbability: mix(a.precipitationProbability, b.precipitationProbability),
    precipitationAmount: mix(a.precipitationAmount, b.precipitationAmount),
    humidity: mix(a.humidity, b.humidity),
    visibility: mix(a.visibility, b.visibility),
    windSpeed: mix(a.windSpeed, b.windSpeed),
    windDirection: mixAngle(a.windDirection, b.windDirection),
    weatherCode: f < 0.5 ? a.weatherCode : b.weatherCode,
    directNormalIrradiance: mix(a.directNormalIrradiance, b.directNormalIrradiance),
    diffuseRadiation: mix(a.diffuseRadiation, b.diffuseRadiation),
    shortwaveRadiation: mix(a.shortwaveRadiation, b.shortwaveRadiation),
  };
}

/** WMO 4677 code → coarse family used by the UI and the scenario mapper. */
export type WeatherFamily = 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunderstorm' | 'unknown';

export function weatherFamily(code: number | null): WeatherFamily {
  if (code === null) return 'unknown';
  if (code === 0) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  return 'unknown';
}

export function describeWeatherCode(code: number | null): string {
  const names: Record<number, string> = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers', 85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
  };
  if (code === null) return 'Unknown';
  return names[code] ?? `Weather code ${code}`;
}

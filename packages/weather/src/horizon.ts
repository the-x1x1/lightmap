/**
 * Forecast horizon (plan §9): "if selected timestamp ≤ reliable provider horizon: FORECAST else
 * SCENARIO". Pure, unit tested, and the single place the UX mode is decided.
 *
 *  - FORECAST           within the provider's reliable horizon (default 7 days)
 *  - EXTENDED_FORECAST  beyond reliable but within what the provider returns (day 8–16):
 *                       shown as a forecast with a clear "low confidence" badge
 *  - SCENARIO           beyond the provider's horizon, or no provider, or provider error
 *  - RECENT_PAST        within the archive window (the provider serves observed/analysis data)
 *  - PAST               older than the archive; treated like a scenario ("historical weather not
 *                       loaded") — never silently shown as a forecast
 */
import type { WeatherCapabilities } from './model.ts';

export type WeatherMode = 'FORECAST' | 'EXTENDED_FORECAST' | 'SCENARIO' | 'RECENT_PAST' | 'PAST';

export interface HorizonDecision {
  mode: WeatherMode;
  /** Hours between now and the selected instant (negative = past). */
  leadHours: number;
  /** User-facing reason, e.g. "Forecast unavailable this far ahead (12 days)". */
  reason: string;
  /** Whether a provider call is worth making for this instant. */
  fetchWorthwhile: boolean;
  weatherConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'SCENARIO';
}

export function decideWeatherMode(
  selected: Date,
  now: Date,
  caps: WeatherCapabilities | null,
): HorizonDecision {
  const leadHours = (selected.getTime() - now.getTime()) / 3_600_000;
  const days = Math.round(Math.abs(leadHours) / 24);
  if (!caps) {
    return {
      mode: 'SCENARIO',
      leadHours,
      reason: 'No weather provider configured — choose a scenario',
      fetchWorthwhile: false,
      weatherConfidence: 'SCENARIO',
    };
  }
  if (leadHours < 0) {
    if (-leadHours <= caps.historicalDays * 24) {
      return {
        mode: 'RECENT_PAST',
        leadHours,
        reason: 'Recent conditions from the provider archive',
        fetchWorthwhile: true,
        weatherConfidence: 'HIGH',
      };
    }
    return {
      mode: 'PAST',
      leadHours,
      reason: `Historical weather for ${days} days ago is not loaded — showing a scenario`,
      fetchWorthwhile: false,
      weatherConfidence: 'SCENARIO',
    };
  }
  if (leadHours <= caps.reliableHorizonHours) {
    const conf = leadHours <= 48 ? 'HIGH' : 'MEDIUM';
    return {
      mode: 'FORECAST',
      leadHours,
      reason: leadHours <= 48 ? 'Forecast' : `Forecast, ${days} days ahead`,
      fetchWorthwhile: true,
      weatherConfidence: conf,
    };
  }
  if (leadHours <= caps.maxHorizonHours) {
    return {
      mode: 'EXTENDED_FORECAST',
      leadHours,
      reason: `Extended forecast, ${days} days ahead — low confidence`,
      fetchWorthwhile: true,
      weatherConfidence: 'LOW',
    };
  }
  return {
    mode: 'SCENARIO',
    leadHours,
    reason: `Forecast unavailable this far ahead (${days} days) — compare scenarios`,
    fetchWorthwhile: false,
    weatherConfidence: 'SCENARIO',
  };
}

/** A day's worth of frames is fetched once per (grid cell, civil day, provider); this is that key. */
export function forecastCacheKey(
  providerId: string,
  gridKey: string,
  dayIso: string,
  providerVersion = 1,
): string {
  return `weather:${providerId}:v${providerVersion}:${gridKey}:${dayIso}`;
}

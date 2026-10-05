/**
 * "Return later as a shoot approaches and see the forecast become more specific" (North Star):
 * what the weather basis for a saved viewpoint is *now*, compared with what it was when saved.
 * Pure, so the project panel's nudges are unit tested.
 */
import { decideWeatherMode, type WeatherCapabilities } from '@lightmap/weather';
import type { ViewpointDto } from '@/lib/api-types';

export interface ForecastNudge {
  kind: 'forecast' | 'extended' | 'past';
  text: string;
}

export function forecastNudge(
  viewpoint: Pick<ViewpointDto, 'selectedDatetimeUtc' | 'weatherMode'>,
  caps: WeatherCapabilities | null,
  now: Date,
): ForecastNudge | null {
  if (!caps) return null;
  const d = decideWeatherMode(new Date(viewpoint.selectedDatetimeUtc), now, caps);
  if (d.mode === 'FORECAST' && viewpoint.weatherMode !== 'FORECAST')
    return { kind: 'forecast', text: 'Forecast available now — open to see it' };
  if (d.mode === 'EXTENDED_FORECAST' && viewpoint.weatherMode === 'SCENARIO')
    return { kind: 'extended', text: 'Extended forecast available (low confidence)' };
  // A date that has passed since the viewpoint was saved with a forecast or a scenario; one
  // saved as the past already says so on its own line.
  if (
    (d.mode === 'RECENT_PAST' || d.mode === 'PAST') &&
    viewpoint.weatherMode !== 'RECENT_PAST' &&
    viewpoint.weatherMode !== 'PAST'
  )
    return {
      kind: 'past',
      text: d.fetchWorthwhile ? 'Date has passed — observed conditions on open' : 'Date has passed',
    };
  return null;
}

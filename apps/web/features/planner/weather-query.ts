/**
 * The one definition of the client's weather query — key, fetch, cache times, retry — so the
 * planner, the week ahead, the finder and the saved viewpoint cards share the same cache entry
 * for a (place, civil day, zone) and can never drift apart. Observers that must only *read* the
 * cache spread these options with `enabled: false`: the query still carries the real fetch, so
 * an incidental refetch elsewhere does the right thing instead of manufacturing an error.
 */
import type { GeoPoint } from '@lightmap/geospatial';
import { gridKey } from '@lightmap/geospatial';
import { ApiRequestError, fetchJson } from '@/lib/client/api';
import type { WeatherResponse } from '@/lib/api-types';

export function weatherQueryKey(point: GeoPoint, date: string, timeZone: string) {
  // The zone is part of the key: the same civil date is a different 24 h in another zone.
  return ['weather', gridKey(point), date, timeZone] as const;
}

export function weatherQueryOptions(point: GeoPoint, date: string, timeZone: string) {
  return {
    queryKey: weatherQueryKey(point, date, timeZone),
    queryFn: () =>
      fetchJson<WeatherResponse>(
        `/api/weather?lat=${point.latitude.toFixed(4)}&lng=${point.longitude.toFixed(4)}&date=${date}&tz=${encodeURIComponent(timeZone)}`,
      ),
    staleTime: 30 * 60_000,
    gcTime: 6 * 60 * 60_000,
    // One retry for a flaky network or provider; a 4xx (the plan window, a bad request) is final.
    retry: (count: number, error: unknown) =>
      count < 1 && !(error instanceof ApiRequestError && error.status < 500),
  };
}

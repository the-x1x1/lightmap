'use client';
import { useQuery } from '@tanstack/react-query';
import type { LocationState } from '@lightmap/scene';
import { fetchJson } from '@/lib/client/api';
import type { ClimatologyResponse } from '@/lib/api-types';

/**
 * "Typical for this month" for the selected place and civil month. Only fetched when the plan
 * allows it (the server enforces the entitlement too); cached a day client-side, 30 days server-side.
 */
export function useClimatology(location: LocationState | null, month: number, enabled: boolean) {
  const cellLat = location ? Math.round(location.point.latitude * 2) / 2 : null;
  const cellLng = location ? Math.round(location.point.longitude * 2) / 2 : null;
  return useQuery({
    queryKey: ['climatology', cellLat, cellLng, month, location?.timeZone ?? null],
    enabled: enabled && location !== null && month >= 1 && month <= 12,
    queryFn: () =>
      fetchJson<ClimatologyResponse>(
        `/api/climatology?lat=${location!.point.latitude.toFixed(4)}&lng=${location!.point.longitude.toFixed(4)}&month=${month}&tz=${encodeURIComponent(location!.timeZone)}&v=2`,
      ),
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  });
}

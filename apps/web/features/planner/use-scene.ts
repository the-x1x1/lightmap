'use client';
/**
 * useScene: the one place SceneState is built on the client. Astronomy runs inline per tick;
 * weather frames come from TanStack Query (fetched once per place+day, interpolated locally —
 * plan §19); capabilities come from /api/scene/capabilities.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { computeDayEvents, parseCivilDate, type DayEvents } from '@lightmap/astronomy';
import {
  buildSceneState,
  DEFAULT_RENDER_SETTINGS,
  type EnvironmentState,
  type RenderSettings,
  type SceneState,
} from '@lightmap/scene';
import { decideWeatherMode, type WeatherCapabilities, type WeatherFrame } from '@lightmap/weather';
import { gridKey } from '@lightmap/geospatial';
import { effectiveTimeZone, selectedUtc, usePlannerStore } from './store.ts';
import { ApiRequestError, fetchJson } from '@/lib/client/api';
import { useSettled } from '@/lib/use-settled';
import type { CapabilitiesResponse, WeatherResponse } from '@/lib/api-types';

export interface SceneBundle {
  scene: SceneState | null;
  utc: Date | null;
  dayEvents: DayEvents | null;
  weather: {
    loading: boolean;
    error: string | null;
    providerFailed: boolean;
    capabilities: WeatherCapabilities | null;
    /** The day's fetched frames (empty in scenario mode). */
    frames: readonly WeatherFrame[];
    /** How the frames were obtained; null when nothing was fetched. */
    mode: WeatherResponse['mode'] | null;
  };
  capabilities: CapabilitiesResponse | null;
  environment: EnvironmentState;
}

const EMPTY_FRAMES: readonly WeatherFrame[] = [];
/** How long the date must hold still before its weather is fetched (a slider drag, not a click). */
export const WEATHER_DATE_SETTLE_MS = 300;

const FALLBACK_ENV: EnvironmentState = {
  terrainAvailable: false,
  terrainProviderId: 'ellipsoid',
  basemapProviderId: 'natural-earth-ii',
  basemapDetail: 'coarse',
  buildingsAvailable: false,
  groundElevationM: null,
  attributions: [{ id: 'natural-earth-ii', attribution: 'Natural Earth II — public domain' }],
  fixtureMode: true,
};

export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: () => fetchJson<CapabilitiesResponse>('/api/scene/capabilities'),
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

export function environmentFromCapabilities(
  c: CapabilitiesResponse | null,
  groundElevationM: number | null,
): EnvironmentState {
  if (!c) return FALLBACK_ENV;
  return {
    terrainAvailable: c.providers.terrain.kind !== 'ellipsoid',
    terrainProviderId: c.providers.terrain.providerId,
    basemapProviderId: c.providers.basemap.providerId,
    basemapDetail: c.providers.basemap.detailLevel,
    buildingsAvailable: false,
    groundElevationM,
    attributions: c.providers.attributions,
    fixtureMode: c.fixtureMode,
  };
}

export function useScene(
  opts: { now?: Date; render?: RenderSettings; includeLunar?: boolean } = {},
): SceneBundle {
  const location = usePlannerStore((s) => s.location);
  const date = usePlannerStore((s) => s.date);
  const minutes = usePlannerStore((s) => s.minutes);
  const scenario = usePlannerStore((s) => s.scenario);
  const forceScenario = usePlannerStore((s) => s.forceScenario);
  const horizonProfile = usePlannerStore((s) => s.horizonProfile);
  const camera = usePlannerStore((s) => s.camera);
  const timeZoneMode = usePlannerStore((s) => s.timeZoneMode);
  // The zone the planner reads times in: the place's own, or the device's when preferred (plan
  // §17). The weather day, day events and the scene's clock follow it; the place keeps its zone.
  const timeZone = effectiveTimeZone({ location, timeZoneMode });
  const utc = useMemo(
    () => selectedUtc({ location, date, minutes, timeZoneMode }),
    [location, date, minutes, timeZoneMode],
  );
  const caps = useCapabilities();
  const now = opts.now ?? new Date();

  const weatherCaps: WeatherCapabilities | null = caps.data?.weather ?? null;
  const horizon = utc ? decideWeatherMode(utc, now, weatherCaps) : null;
  const cell = location ? gridKey(location.point) : null;

  // The weather day waits for the date to settle: the day-of-year slider can pass fifty dates in
  // a second, each a separate day's fetch against the route's burst limit and the daily budget.
  // Astronomy, day events and the scene follow the live date; only the fetch is held back.
  const settledDate = useSettled(date, WEATHER_DATE_SETTLE_MS);
  const dateSettled = settledDate === date;
  const weatherQuery = useQuery({
    // The zone is part of the key: the same civil date is a different 24 h in another zone.
    queryKey: ['weather', cell, settledDate, timeZone],
    enabled: Boolean(location && cell && horizon?.fetchWorthwhile && dateSettled),
    queryFn: () =>
      fetchJson<WeatherResponse>(
        `/api/weather?lat=${location!.point.latitude.toFixed(4)}&lng=${location!.point.longitude.toFixed(4)}&date=${settledDate}&tz=${encodeURIComponent(timeZone)}`,
      ),
    staleTime: 30 * 60_000,
    gcTime: 6 * 60 * 60_000,
    // One retry for a flaky network or provider; a 4xx (the plan window, a bad request) is final.
    retry: (count, error) => count < 1 && !(error instanceof ApiRequestError && error.status < 500),
  });

  // Day events depend only on place + date + zone; cache them so scrubbing does not recompute.
  const dayEvents = useMemo(() => {
    if (!location) return null;
    const civil = parseCivilDate(date);
    if (!civil) return null;
    return computeDayEvents({
      latitude: location.point.latitude,
      longitude: location.point.longitude,
      timeZone,
      date: civil,
    });
  }, [location, date, timeZone]);

  const environment = useMemo(
    () => environmentFromCapabilities(caps.data ?? null, location?.point.elevationM ?? null),
    [caps.data, location?.point.elevationM],
  );

  // Frames belong to the settled day only; while the date is moving the scene runs on scenarios.
  const frames: readonly WeatherFrame[] = dateSettled
    ? (weatherQuery.data?.frames ?? EMPTY_FRAMES)
    : EMPTY_FRAMES;
  // A 403 is the plan's date window (the paywall is already on screen), not a provider failure.
  const providerFailed = Boolean(
    dateSettled &&
    horizon?.fetchWorthwhile &&
    weatherQuery.isError &&
    !(weatherQuery.error instanceof ApiRequestError && weatherQuery.error.status === 403),
  );

  const scene = useMemo(() => {
    if (!location || !utc || !dayEvents) return null;
    return buildSceneState({
      location,
      timeZone,
      utc,
      now,
      camera,
      environment,
      scenario,
      forceScenario,
      weather: { capabilities: weatherCaps, frames, providerFailed },
      render: opts.render ?? DEFAULT_RENDER_SETTINGS,
      includeLunar: opts.includeLunar ?? true,
      realReference: false,
      dayEvents,
      horizonProfile,
    });
    // `now` changes every render but only matters at the horizon boundary; exclude to avoid churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    location,
    timeZone,
    utc,
    dayEvents,
    camera,
    environment,
    scenario,
    forceScenario,
    weatherCaps,
    frames,
    providerFailed,
    opts.render,
    opts.includeLunar,
    horizonProfile,
  ]);

  return {
    scene,
    utc,
    dayEvents,
    weather: {
      loading: (!dateSettled && Boolean(horizon?.fetchWorthwhile)) || weatherQuery.isLoading,
      error: dateSettled && weatherQuery.error ? String(weatherQuery.error) : null,
      providerFailed,
      capabilities: weatherCaps,
      frames,
      mode: dateSettled ? (weatherQuery.data?.mode ?? null) : null,
    },
    capabilities: caps.data ?? null,
    environment,
  };
}

'use client';
/**
 * useScene: the one place SceneState is built on the client. Astronomy runs inline per tick;
 * weather frames come from TanStack Query (fetched once per place+day, interpolated locally —
 * plan §19); capabilities come from /api/scene/capabilities.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { computeDayEvents, parseCivilDate, type DayEvents } from '@lightmap/astronomy';
import { buildSceneState, DEFAULT_RENDER_SETTINGS, type EnvironmentState, type RenderSettings, type SceneState } from '@lightmap/scene';
import { decideWeatherMode, type WeatherCapabilities, type WeatherFrame } from '@lightmap/weather';
import { gridKey } from '@lightmap/geospatial';
import { selectedUtc, usePlannerStore } from './store.ts';
import { fetchJson } from '@/lib/client/api';
import type { CapabilitiesResponse, WeatherResponse } from '@/lib/api-types';

export interface SceneBundle {
  scene: SceneState | null;
  utc: Date | null;
  dayEvents: DayEvents | null;
  weather: { loading: boolean; error: string | null; providerFailed: boolean; capabilities: WeatherCapabilities | null };
  capabilities: CapabilitiesResponse | null;
  environment: EnvironmentState;
}

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

export function environmentFromCapabilities(c: CapabilitiesResponse | null, groundElevationM: number | null): EnvironmentState {
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

export function useScene(opts: { now?: Date; render?: RenderSettings; includeLunar?: boolean } = {}): SceneBundle {
  const location = usePlannerStore((s) => s.location);
  const date = usePlannerStore((s) => s.date);
  const minutes = usePlannerStore((s) => s.minutes);
  const scenario = usePlannerStore((s) => s.scenario);
  const forceScenario = usePlannerStore((s) => s.forceScenario);
  const camera = usePlannerStore((s) => s.camera);
  const utc = useMemo(() => selectedUtc({ location, date, minutes }), [location, date, minutes]);
  const caps = useCapabilities();
  const now = opts.now ?? new Date();

  const weatherCaps: WeatherCapabilities | null = caps.data?.weather ?? null;
  const horizon = utc ? decideWeatherMode(utc, now, weatherCaps) : null;
  const cell = location ? gridKey(location.point) : null;

  const weatherQuery = useQuery({
    queryKey: ['weather', cell, date],
    enabled: Boolean(location && cell && horizon?.fetchWorthwhile),
    queryFn: () => fetchJson<WeatherResponse>(`/api/weather?lat=${location!.point.latitude.toFixed(4)}&lng=${location!.point.longitude.toFixed(4)}&date=${date}&tz=${encodeURIComponent(location!.timeZone)}`),
    staleTime: 30 * 60_000,
    gcTime: 6 * 60 * 60_000,
    retry: 1,
  });

  // Day events depend only on place + date + zone; cache them so scrubbing does not recompute.
  const dayEvents = useMemo(() => {
    if (!location) return null;
    const civil = parseCivilDate(date);
    if (!civil) return null;
    return computeDayEvents({ latitude: location.point.latitude, longitude: location.point.longitude, timeZone: location.timeZone, date: civil });
  }, [location, date]);

  const environment = useMemo(() => environmentFromCapabilities(caps.data ?? null, location?.point.elevationM ?? null), [caps.data, location?.point.elevationM]);

  const frames: readonly WeatherFrame[] = weatherQuery.data?.frames ?? [];
  const providerFailed = Boolean(horizon?.fetchWorthwhile && weatherQuery.isError);

  const scene = useMemo(() => {
    if (!location || !utc || !dayEvents) return null;
    return buildSceneState({
      location,
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
    });
    // `now` changes every render but only matters at the horizon boundary; exclude to avoid churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, utc, dayEvents, camera, environment, scenario, forceScenario, weatherCaps, frames, providerFailed, opts.render, opts.includeLunar]);

  return {
    scene,
    utc,
    dayEvents,
    weather: { loading: weatherQuery.isLoading, error: weatherQuery.error ? String(weatherQuery.error) : null, providerFailed, capabilities: weatherCaps },
    capabilities: caps.data ?? null,
    environment,
  };
}

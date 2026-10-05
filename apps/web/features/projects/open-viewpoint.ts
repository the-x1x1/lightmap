/**
 * Reopening a saved viewpoint (plan §4 "return later"): the planner state it restores — the
 * place with its own zone, the instant, the camera (lens equivalent → field of view) and the
 * scenario it was saved with. One mapping for the drawer's "Open" and for a viewpoint link. Pure.
 */
import { horizontalFovDeg, type CameraState, type LocationState } from '@lightmap/scene';
import { isScenarioId, type WeatherScenarioId } from '@lightmap/weather';
import type { ViewpointDto } from '@/lib/api-types';

export interface RestoreInput {
  location: LocationState;
  utc: Date;
  camera: CameraState;
  scenario: WeatherScenarioId | null;
}

export function restoreInputFor(v: ViewpointDto): RestoreInput {
  return {
    location: {
      point: {
        latitude: v.latitude,
        longitude: v.longitude,
        ...(v.elevationM !== null ? { elevationM: v.elevationM } : {}),
      },
      timeZone: v.timezone,
      label: v.label,
      source: 'saved',
    },
    utc: new Date(v.selectedDatetimeUtc),
    camera: {
      eye: { latitude: v.latitude, longitude: v.longitude },
      eyeHeightM: 1.7,
      headingDeg: v.headingDeg,
      pitchDeg: v.pitchDeg,
      fovDeg: v.focalLengthEquivalentMm
        ? horizontalFovDeg(v.focalLengthEquivalentMm)
        : v.fieldOfViewDeg,
      focalLengthMm: v.focalLengthEquivalentMm,
      mode: 'viewpoint',
    },
    scenario: v.weatherScenario && isScenarioId(v.weatherScenario) ? v.weatherScenario : null,
  };
}

/** The viewpoint id named by a planner URL (`/?viewpoint=<id>`), or null. */
export function viewpointIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('viewpoint');
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** The URL that reopens a viewpoint (the shot list carries one per block). */
export function viewpointUrl(appUrl: string, id: string): string {
  return `${appUrl.replace(/\/+$/, '')}/?viewpoint=${encodeURIComponent(id)}`;
}

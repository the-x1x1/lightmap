import 'server-only';
import type { Project, Viewpoint } from '@lightmap/database';
import type { ProjectDto, ViewpointDto } from '@/lib/api-types';

export function projectDto(p: Project & { viewpointCount?: number }): ProjectDto {
  return { id: p.id, name: p.name, description: p.description, shootDate: p.shootDate, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(), viewpointCount: p.viewpointCount ?? 0 };
}

export function viewpointDto(v: Viewpoint & { snapshot?: { thumbnailDataUrl: string | null } | null }): ViewpointDto {
  return {
    id: v.id,
    projectId: v.projectId,
    label: v.label,
    latitude: v.latitude,
    longitude: v.longitude,
    elevationM: v.elevationM,
    timezone: v.timezone,
    headingDeg: v.headingDeg,
    pitchDeg: v.pitchDeg,
    fieldOfViewDeg: v.fieldOfViewDeg,
    focalLengthEquivalentMm: v.focalLengthEquivalentMm,
    selectedDatetimeUtc: v.selectedDatetimeUtc.toISOString(),
    weatherMode: v.weatherMode,
    weatherScenario: v.weatherScenario,
    previewSourceType: v.previewSourceType,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    thumbnailDataUrl: v.snapshot?.thumbnailDataUrl ?? null,
  };
}

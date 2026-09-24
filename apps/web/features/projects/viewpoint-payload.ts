import type { SceneState } from '@lightmap/scene';

/** Build the save body from the current SceneState (plan §4 "Each project can contain saved viewpoints"). */
export function viewpointPayload(
  scene: SceneState,
  label: string,
  thumbnailDataUrl: string | null,
) {
  return {
    label,
    latitude: scene.location.point.latitude,
    longitude: scene.location.point.longitude,
    elevationM: scene.location.point.elevationM ?? scene.environment.groundElevationM ?? null,
    timezone: scene.location.timeZone,
    headingDeg: scene.camera.headingDeg,
    pitchDeg: scene.camera.pitchDeg,
    fieldOfViewDeg: scene.camera.fovDeg,
    focalLengthEquivalentMm: scene.camera.focalLengthMm,
    selectedDatetimeUtc: scene.utc.toISOString(),
    weatherMode: scene.atmosphere.mode,
    weatherScenario: scene.atmosphere.mode === 'SCENARIO' ? scene.atmosphere.scenario : null,
    previewSourceType: scene.sourceMode,
    snapshot: {
      sourceType: scene.sourceMode,
      providerMetadata: {
        terrain: scene.environment.terrainProviderId,
        basemap: scene.environment.basemapProviderId,
        weather: scene.atmosphere.providerId,
      },
      astronomyState: {
        azimuthDegrees: scene.solar.azimuthDegrees,
        elevationDegrees: scene.solar.elevationDegrees,
        phase: scene.solar.phase,
        sunrise: scene.dayEvents.sunrise?.toISOString() ?? null,
        sunset: scene.dayEvents.sunset?.toISOString() ?? null,
      },
      weatherState: {
        mode: scene.atmosphere.mode,
        scenario: scene.atmosphere.scenario,
        parameters: scene.atmosphere.parameters,
        frame: scene.atmosphere.frame,
      },
      confidenceState: scene.confidence,
      thumbnailDataUrl,
    },
  };
}

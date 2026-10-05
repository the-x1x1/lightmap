'use client';
/**
 * The Sun's seasonal envelope at the selected place (plan §1 "seasonal path"): memoised per
 * place and year, since two solstice day computations are a few hundred solar positions.
 */
import { useMemo } from 'react';
import { seasonalEnvelope, type SeasonalEnvelope } from '@lightmap/scene';
import type { SceneState } from '@lightmap/scene';

export function useSeasonalEnvelope(scene: SceneState): SeasonalEnvelope {
  const lat = scene.location.point.latitude;
  const lng = scene.location.point.longitude;
  const tz = scene.location.timeZone;
  const year = Number(scene.localTime.date.slice(0, 4));
  return useMemo(
    () => seasonalEnvelope({ latitude: lat, longitude: lng }, tz, year),
    [lat, lng, tz, year],
  );
}

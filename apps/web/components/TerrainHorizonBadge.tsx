'use client';
/**
 * "Behind terrain" (plan §26): the Sun is astronomically up but below the sampled terrain
 * horizon at its bearing, so the viewpoint is still in shadow. Only rendered when a terrain
 * horizon exists; the caveat (trees/buildings not modelled) travels with it.
 */
import type { SceneState } from '@lightmap/scene';
import { Badge, VisuallyHidden } from '@lightmap/ui';

export function TerrainHorizonBadge({ scene }: { scene: SceneState }) {
  const t = scene.terrainHorizon;
  if (!t || !scene.solar.isAboveHorizon) return null;
  if (t.sunAboveTerrain) return null;
  return (
    <Badge
      tone="warn"
      icon="⛰"
      title={`The terrain horizon at the sun's bearing is ${t.horizonAtSunDeg.toFixed(1)}°; the sun is at ${scene.solar.elevationDegrees.toFixed(1)}°. ${t.profile.caveat}`}
      data-testid="terrain-badge"
    >
      Sun behind terrain
      <VisuallyHidden>
        . Terrain horizon {t.horizonAtSunDeg.toFixed(1)} degrees at the sun's bearing; the sun is at{' '}
        {scene.solar.elevationDegrees.toFixed(1)} degrees. {t.profile.caveat}
      </VisuallyHidden>
    </Badge>
  );
}

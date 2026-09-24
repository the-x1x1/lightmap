'use client';
/**
 * "Behind terrain" (plan §26): the Sun is astronomically up but below the sampled terrain
 * horizon at its bearing, so the viewpoint is still in shadow. Only rendered when a terrain
 * horizon exists; the caveat (trees/buildings not modelled) travels with it.
 */
import { formatDeg, type SceneState } from '@lightmap/scene';
import { Badge, VisuallyHidden } from '@lightmap/ui';

export function TerrainHorizonBadge({ scene }: { scene: SceneState }) {
  const t = scene.terrainHorizon;
  if (!t || !scene.solar.isAboveHorizon) return null;
  if (t.sunAboveTerrain) return null;
  return (
    <Badge
      tone="warn"
      icon="⛰"
      title={`The terrain horizon at the sun's bearing is ${formatDeg(t.horizonAtSunDeg)}°; the sun's upper limb is at ${formatDeg(scene.solar.apparentElevationDegrees + 0.27)}°. ${t.profile.caveat}`}
      data-testid="terrain-badge"
    >
      Sun behind terrain
      <VisuallyHidden>
        . Terrain horizon {formatDeg(t.horizonAtSunDeg)} degrees at the sun's bearing; the sun's
        upper limb is at {formatDeg(scene.solar.apparentElevationDegrees + 0.27)} degrees.{' '}
        {t.profile.caveat}
      </VisuallyHidden>
    </Badge>
  );
}

'use client';
/** Full-bleed sky gradient for overlay mode: the cheapest honest depiction of sky luminance and warmth. */
import { lightingFromScene } from '@lightmap/renderer';
import type { SceneState } from '@lightmap/scene';

export function SkyBackdrop({ scene }: { scene: SceneState }) {
  const [zenith, mid, horizon] = lightingFromScene(scene).skyGradient;
  return (
    <div
      aria-hidden
      className="absolute inset-0 transition-[background] duration-300"
      style={{
        background: `linear-gradient(to bottom, ${zenith} 0%, ${mid} 55%, ${horizon} 100%)`,
      }}
      data-testid="sky-backdrop"
    />
  );
}

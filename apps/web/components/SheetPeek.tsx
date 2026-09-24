'use client';
/**
 * What the collapsed bottom sheet shows on a phone (plan §20): the one line a photographer glances
 * at while looking at the map — local time, light phase, where the sun is, and what the weather
 * basis is — as a button that opens the sheet. Nothing here is interactive beyond that, so the
 * inert body underneath loses nothing.
 */
import type { SceneState } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { VisuallyHidden } from '@lightmap/ui';

const PHASE_LABEL: Record<SceneState['solar']['phase'], string> = {
  night: 'Night',
  'astronomical-twilight': 'Astronomical twilight',
  'nautical-twilight': 'Nautical twilight',
  'civil-twilight': 'Civil twilight',
  'blue-hour': 'Blue hour',
  'golden-hour': 'Golden hour',
  day: 'Daylight',
};

function weatherWord(scene: SceneState): string {
  switch (scene.atmosphere.mode) {
    case 'FORECAST':
      return `${Math.round(scene.atmosphere.parameters.cloudCover * 100)} % cloud · forecast`;
    case 'RECENT_PAST':
      return `${Math.round(scene.atmosphere.parameters.cloudCover * 100)} % cloud · recent conditions`;
    case 'EXTENDED_FORECAST':
      return `${Math.round(scene.atmosphere.parameters.cloudCover * 100)} % cloud · extended · low confidence`;
    case 'SCENARIO':
    case 'PAST':
      return 'scenario';
  }
}

export function SheetPeek({ scene, onOpen }: { scene: SceneState | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-11 w-full items-center justify-between gap-3 px-4 text-left lg:hidden"
      data-testid="sheet-peek"
    >
      <VisuallyHidden>Open the planning panel. </VisuallyHidden>
      {scene ? (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-lg tabular-nums">{scene.localTime.time}</span>
          <span className="truncate text-sm text-[var(--lm-text-muted)]">
            {PHASE_LABEL[scene.solar.phase]}
            {scene.solar.elevationDegrees > -0.833
              ? ` · Sun ${Math.round(scene.solar.azimuthDegrees)}° ${compassLabel(scene.solar.azimuthDegrees)}`
              : ''}
            {' · '}
            {weatherWord(scene)}
          </span>
        </span>
      ) : (
        <span className="truncate text-sm text-[var(--lm-text-muted)]">
          Search a place or tap the globe to start
        </span>
      )}
      <span aria-hidden className="shrink-0 text-[var(--lm-text-muted)]">
        ▲
      </span>
    </button>
  );
}

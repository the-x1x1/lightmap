'use client';
import type { SceneState } from '@lightmap/scene';
import { Badge, VisuallyHidden } from '@lightmap/ui';

/**
 * Honest label for the weather basis (plan §9): FORECAST / EXTENDED / SCENARIO — never a fake
 * forecast. The one-line reason is exposed to assistive tech as well as on hover; the full text is
 * also shown in the confidence panel.
 */
export function ForecastBadge({ scene, loading }: { scene: SceneState; loading?: boolean }) {
  if (loading)
    return (
      <Badge tone="neutral" icon="…">
        Loading forecast
      </Badge>
    );
  const note = scene.confidence.notes.weather;
  const why = <VisuallyHidden>. {note}</VisuallyHidden>;
  switch (scene.atmosphere.mode) {
    case 'FORECAST':
      return (
        <Badge tone="ok" icon="◉" title={note} data-testid="forecast-badge">
          Forecast{why}
        </Badge>
      );
    case 'RECENT_PAST':
      return (
        <Badge tone="ok" icon="◉" title={note}>
          Recent conditions{why}
        </Badge>
      );
    case 'EXTENDED_FORECAST':
      return (
        <Badge tone="warn" icon="◔" title={note}>
          Extended · low confidence{why}
        </Badge>
      );
    case 'SCENARIO':
    case 'PAST':
      return (
        <Badge tone="twilight" icon="◌" title={note} data-testid="scenario-badge">
          Scenario · not a forecast{why}
        </Badge>
      );
  }
}

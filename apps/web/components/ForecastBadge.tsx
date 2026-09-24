'use client';
import type { SceneState } from '@lightmap/scene';
import { Badge } from '@lightmap/ui';

/** Honest label for the weather basis (plan §9): FORECAST / EXTENDED / SCENARIO — never a fake forecast. */
export function ForecastBadge({ scene, loading }: { scene: SceneState; loading?: boolean }) {
  if (loading) return <Badge tone="neutral" icon="…">Loading forecast</Badge>;
  switch (scene.atmosphere.mode) {
    case 'FORECAST':
      return <Badge tone="ok" icon="◉" title={scene.confidence.notes.weather} data-testid="forecast-badge">Forecast</Badge>;
    case 'RECENT_PAST':
      return <Badge tone="ok" icon="◉" title={scene.confidence.notes.weather}>Recent conditions</Badge>;
    case 'EXTENDED_FORECAST':
      return <Badge tone="warn" icon="◔" title={scene.confidence.notes.weather}>Extended · low confidence</Badge>;
    case 'SCENARIO':
    case 'PAST':
      return <Badge tone="twilight" icon="◌" title={scene.confidence.notes.weather} data-testid="scenario-badge">Scenario · not a forecast</Badge>;
  }
}

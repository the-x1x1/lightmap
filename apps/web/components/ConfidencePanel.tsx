import type { SceneState } from '@lightmap/scene';
import { SOURCE_MODE_DESCRIPTION } from '@lightmap/scene';
import { PreviewSourceBadge } from './PreviewSourceBadge';

const LEVEL_GLYPH: Record<string, string> = {
  HIGH: '●●●',
  MEDIUM: '●●○',
  LOW: '●○○',
  SCENARIO: '◌',
  REAL_REFERENCE: '▣',
  NONE: '—',
};
const LEVEL_TEXT: Record<string, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  SCENARIO: 'Scenario',
  REAL_REFERENCE: 'Real reference',
  NONE: 'Unavailable',
};

/** "Preview basis" (plan §11): independent dimensions, no invented percentage. */
export function ConfidencePanel({ scene }: { scene: SceneState }) {
  const c = scene.confidence;
  const rows: Array<[string, string, string]> = [
    ['Astronomy', c.astronomy, c.notes.astronomy],
    ['Terrain', c.terrain, c.terrain === 'HIGH' ? 'Real elevation data' : 'Flat ground assumed'],
    ['Scene detail', c.sceneDetail, c.notes.environment],
    ['Weather', c.weather, c.notes.weather],
    ['Real reference', c.imagery, c.notes.imagery],
  ];
  return (
    <section aria-labelledby="lm-confidence-h" data-testid="confidence-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3
          id="lm-confidence-h"
          className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]"
        >
          Preview basis
        </h3>
        <PreviewSourceBadge mode={scene.sourceMode} />
      </div>
      <p className="mb-2 text-xs text-[var(--lm-text-muted)]">
        {SOURCE_MODE_DESCRIPTION[scene.sourceMode]}
      </p>
      <dl className="space-y-1 text-sm">
        {rows.map(([label, level, note]) => (
          <div key={label} className="border-b border-white/5 py-1">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[var(--lm-text-muted)]">{label}</dt>
              <dd
                className="text-right"
                data-testid={`confidence-${label.toLowerCase().replace(/\s+/g, '-')}`}
                data-value={level}
              >
                <span aria-hidden className="mr-1.5 font-mono text-xs text-[var(--lm-text-faint)]">
                  {LEVEL_GLYPH[level] ?? ''}
                </span>
                {LEVEL_TEXT[level] ?? level}
              </dd>
            </div>
            {/* The reason is content, not a tooltip: touch and keyboard users never see `title`. */}
            {note ? <dd className="text-xs text-[var(--lm-text-muted)]">{note}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

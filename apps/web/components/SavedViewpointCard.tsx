'use client';
import type { ViewpointDto } from '@/lib/api-types';
import { formatWallTime, utcToWallClock } from '@lightmap/astronomy';
import { compassLabel } from '@lightmap/geospatial';
import { Button } from '@lightmap/ui';
import { PreviewSourceBadge } from './PreviewSourceBadge';

export function SavedViewpointCard({ viewpoint, onOpen, onDelete }: { viewpoint: ViewpointDto; onOpen: () => void; onDelete: () => void }) {
  const utc = new Date(viewpoint.selectedDatetimeUtc);
  const w = utcToWallClock(utc, viewpoint.timezone);
  return (
    <article className="flex gap-3 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-white/3 p-2.5" data-testid="viewpoint-card">
      {viewpoint.thumbnailDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={viewpoint.thumbnailDataUrl} alt="" className="h-16 w-24 shrink-0 rounded object-cover" />
      ) : (
        <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded bg-white/5 text-xs text-[var(--lm-text-faint)]" aria-hidden>no preview</div>
      )}
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-medium">{viewpoint.label}</h4>
        <p className="text-xs text-[var(--lm-text-muted)]">
          {`${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')} ${formatWallTime(utc, viewpoint.timezone)} · ${compassLabel(viewpoint.headingDeg)} ${viewpoint.focalLengthEquivalentMm ? `${viewpoint.focalLengthEquivalentMm} mm` : ''}`}
        </p>
        <p className="mt-1 text-xs text-[var(--lm-text-muted)]">{viewpoint.weatherMode === 'SCENARIO' ? `Scenario: ${viewpoint.weatherScenario ?? '—'}` : viewpoint.weatherMode.toLowerCase().replace('_', ' ')}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <PreviewSourceBadge mode={viewpoint.previewSourceType} />
          <Button size="sm" variant="secondary" onClick={onOpen} data-testid="viewpoint-open">Open</Button>
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${viewpoint.label}`}>Delete</Button>
        </div>
      </div>
    </article>
  );
}

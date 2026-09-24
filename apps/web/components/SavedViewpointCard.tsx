'use client';
import type { ViewpointDto } from '@/lib/api-types';
import { formatWallTime, utcToWallClock } from '@lightmap/astronomy';
import { compassLabel } from '@lightmap/geospatial';
import { Button } from '@lightmap/ui';
import { PreviewSourceBadge } from './PreviewSourceBadge';

export function SavedViewpointCard({
  viewpoint,
  variants = [],
  onOpen,
  onDelete,
  onOpenVariant,
  onDeleteVariant,
  onSaveVariant,
  saveVariantBusy,
}: {
  viewpoint: ViewpointDto;
  /** Shot variants of this viewpoint (same place and camera, other times). */
  variants?: ViewpointDto[];
  onOpen: () => void;
  onDelete: () => void;
  onOpenVariant?: (v: ViewpointDto) => void;
  onDeleteVariant?: (v: ViewpointDto) => void;
  /** Present when the planner currently sits at this viewpoint, so "now" can be saved as a variant. */
  onSaveVariant?: () => void;
  saveVariantBusy?: boolean;
}) {
  const utc = new Date(viewpoint.selectedDatetimeUtc);
  const w = utcToWallClock(utc, viewpoint.timezone);
  const stamp = (d: Date, tz: string) => {
    const x = utcToWallClock(d, tz);
    return `${x.year}-${String(x.month).padStart(2, '0')}-${String(x.day).padStart(2, '0')} ${formatWallTime(d, tz)}`;
  };
  return (
    <article
      className="flex gap-3 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-white/3 p-2.5"
      data-testid="viewpoint-card"
    >
      {viewpoint.thumbnailDataUrl ? (
        <img
          src={viewpoint.thumbnailDataUrl}
          alt=""
          className="h-16 w-24 shrink-0 rounded object-cover"
        />
      ) : (
        <div
          className="flex h-16 w-24 shrink-0 items-center justify-center rounded bg-white/5 text-xs text-[var(--lm-text-faint)]"
          aria-hidden
        >
          no preview
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-medium">{viewpoint.label}</h4>
        <p className="text-xs text-[var(--lm-text-muted)]">
          {`${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')} ${formatWallTime(utc, viewpoint.timezone)} · ${compassLabel(viewpoint.headingDeg)} ${viewpoint.focalLengthEquivalentMm ? `${viewpoint.focalLengthEquivalentMm} mm` : ''}`}
        </p>
        <p className="mt-1 text-xs text-[var(--lm-text-muted)]">
          {viewpoint.weatherMode === 'SCENARIO'
            ? `Scenario: ${viewpoint.weatherScenario ?? '—'}`
            : viewpoint.weatherMode.toLowerCase().replace('_', ' ')}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <PreviewSourceBadge mode={viewpoint.previewSourceType} />
          <Button
            size="sm"
            variant="secondary"
            onClick={onOpen}
            aria-label={`Open ${viewpoint.label}`}
            data-testid="viewpoint-open"
          >
            Open
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            aria-label={`Delete ${viewpoint.label}`}
          >
            Delete
          </Button>
          {onSaveVariant ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onSaveVariant}
              disabled={saveVariantBusy}
              title="Save the planner's current date, time and scenario as another take of this spot"
              data-testid="viewpoint-save-variant"
            >
              {saveVariantBusy ? 'Saving…' : '+ Variant'}
            </Button>
          ) : null}
        </div>
        {variants.length > 0 ? (
          <ul className="mt-2 space-y-1 border-t border-white/5 pt-1.5" aria-label="Shot variants">
            {variants.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono tabular-nums text-[var(--lm-text-muted)]">
                  {stamp(new Date(v.selectedDatetimeUtc), v.timezone)}
                  {v.weatherMode === 'SCENARIO' && v.weatherScenario
                    ? ` · ${v.weatherScenario}`
                    : ''}
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpenVariant?.(v)}
                    aria-label={`Open variant ${stamp(new Date(v.selectedDatetimeUtc), v.timezone)} of ${viewpoint.label}`}
                    data-testid="variant-open"
                  >
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDeleteVariant?.(v)}
                    aria-label={`Delete variant ${stamp(new Date(v.selectedDatetimeUtc), v.timezone)} of ${viewpoint.label}`}
                  >
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

'use client';
/**
 * Timeline chip: "this light lasts until … · back on …". Answers the question every scouting
 * photographer asks after finding a good sun position — how long do I have, and if I miss it, when
 * does it come round again? One click jumps the planner to the return instant.
 *
 * Free plans see the answer inside their date window and an honest "beyond your window · Pro"
 * otherwise (plan §38: explain, never block silently, never leak the Pro answer).
 */
import { useId, useState } from 'react';
import { civilDateString, utcToWallClock } from '@lightmap/astronomy';
import type { SceneState } from '@lightmap/scene';
import { cx } from '@lightmap/ui';
import { usePlannerStore } from '@/features/planner/store';
import { RECURRENCE_TOLERANCE, useNextOccurrence } from '@/features/finder/use-next-occurrence';
import { describeRecurrence } from '@/features/finder/recurrence-text';
import { Paywall } from './Paywall';

export interface NextOccurrenceProps {
  scene: SceneState;
  /** `reverse_planning` decision. */
  allowed: boolean;
  /** Free window end (inclusive civil date at the location) used to clip the search when not allowed. */
  windowEnd: string | null;
  planLoading?: boolean;
  className?: string | undefined;
}

export function NextOccurrence({
  scene,
  allowed,
  windowEnd,
  planLoading = false,
  className,
}: NextOccurrenceProps) {
  const setDate = usePlannerStore((s) => s.setDate);
  const setMinutes = usePlannerStore((s) => s.setMinutes);
  const [showPaywall, setShowPaywall] = useState(false);
  const paywallId = useId();
  const tz = scene.location.timeZone;
  const state = useNextOccurrence(scene, {
    enabled: !planLoading,
    lastDate: allowed ? null : windowEnd,
  });
  if (state.status === 'off') return null;

  const value = state.status === 'ready' ? state.value : state.previous;
  const busy = state.status === 'searching';
  const tolerance = `Sun within ±${RECURRENCE_TOLERANCE.azimuthDegrees}° of its current bearing and ±${RECURRENCE_TOLERANCE.elevationDegrees}° of its current height`;

  if (!value) {
    return (
      <p
        className={cx('text-xs text-[var(--lm-text-muted)]', className)}
        aria-busy
        data-testid="next-occurrence"
      >
        Working out when the sun is here again…
      </p>
    );
  }

  const text = describeRecurrence(value, tz, scene.localTime.date);
  const jump = () => {
    if (!value.next) return;
    const w = utcToWallClock(new Date(value.next.timestampUtc), tz);
    setDate(civilDateString(w));
    setMinutes(w.hour * 60 + w.minute);
  };

  return (
    <div
      className={cx('space-y-1', className)}
      data-testid="next-occurrence"
      aria-busy={busy || undefined}
    >
      <div
        className={cx(
          'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs transition-opacity',
          busy && 'opacity-60',
        )}
      >
        <span className="text-[var(--lm-text-muted)]" data-testid="next-occurrence-lasts">
          <span aria-hidden className="mr-1 text-[var(--lm-sun)]">
            ↻
          </span>
          {text.lasts}
        </span>
        {text.back ? (
          <button
            type="button"
            onClick={jump}
            title={`${tolerance}. Jump the planner to that moment.`}
            className="inline-flex min-h-9 items-center gap-1 rounded-full bg-white/8 px-3 py-1.5 font-medium text-[var(--lm-text)] ring-1 ring-inset ring-white/10 hover:bg-white/15 focus-visible:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
            data-testid="next-occurrence-jump"
          >
            <span className="text-[var(--lm-text-muted)]">Back</span>
            <span>{text.back}</span>
            <span className="font-mono tabular-nums text-[var(--lm-text-muted)]">
              {text.backTime}
            </span>
          </button>
        ) : value.clipped ? (
          <button
            type="button"
            onClick={() => setShowPaywall((v) => !v)}
            aria-expanded={showPaywall}
            aria-controls={paywallId}
            title={
              value.runClipped
                ? "How long this light lasts, and when it returns, lie beyond your plan's date window."
                : "When this light comes back lies beyond your plan's date window."
            }
            className="inline-flex min-h-9 items-center gap-1 rounded-full bg-[color:rgba(245,179,66,0.12)] px-3 py-1.5 font-medium text-[color:#ffd27a] ring-1 ring-inset ring-[color:rgba(245,179,66,0.3)] hover:bg-[color:rgba(245,179,66,0.2)] focus-visible:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
            data-testid="next-occurrence-locked"
          >
            Beyond your date window · Pro
          </button>
        ) : (
          <span className="text-[var(--lm-text-muted)]" data-testid="next-occurrence-none">
            Not back within {value.scannedDays} days
          </span>
        )}
      </div>
      <div id={paywallId}>
        {showPaywall && !text.back && value.clipped ? (
          <Paywall compact reason="See when this exact light returns — any date, years ahead." />
        ) : null}
      </div>
    </div>
  );
}

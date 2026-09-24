'use client';
import { addCivilDays, civilDateString, parseCivilDate } from '@lightmap/astronomy';
import { usePlannerStore } from '@/features/planner/store';
import { Button } from '@lightmap/ui';

/** Date picker with ±1 day steppers and "Today" (at the location's zone). */
export function DateControl({ disabled, blockedReason }: { disabled?: boolean; blockedReason?: string | null }) {
  const date = usePlannerStore((s) => s.date);
  const setDate = usePlannerStore((s) => s.setDate);
  const setNow = usePlannerStore((s) => s.setNow);
  const location = usePlannerStore((s) => s.location);
  const civil = parseCivilDate(date);
  const step = (n: number) => civil && setDate(civilDateString(addCivilDays(civil, n)));
  const human = civil ? new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : date;
  return (
    <div data-testid="date-control">
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor="lm-date" className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">Date</label>
        <span className="text-xs text-[var(--lm-text-muted)]">{location ? location.timeZone : 'device time zone'}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="md" onClick={() => step(-1)} aria-label="Previous day" disabled={disabled}>‹</Button>
        <input id="lm-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={disabled} className="h-11 flex-1 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 text-sm text-[var(--lm-text)] focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]" aria-describedby="lm-date-human" data-testid="date-input" />
        <Button variant="ghost" size="md" onClick={() => step(1)} aria-label="Next day" disabled={disabled}>›</Button>
        <Button variant="ghost" size="md" onClick={() => setNow()} title="Jump to now at this place">Now</Button>
      </div>
      <p id="lm-date-human" className="mt-1 text-xs text-[var(--lm-text-muted)]">{human}</p>
      {blockedReason ? <p className="mt-1 text-xs text-[color:#ffd27a]" role="status">{blockedReason}</p> : null}
    </div>
  );
}

'use client';
import { addCivilDays, civilDateString, parseCivilDate } from '@lightmap/astronomy';
import { effectiveTimeZone, usePlannerStore } from '@/features/planner/store';
import { dateFromDayOfYear, dayOfYear, daysInYear } from '@/lib/civil-year';
import { Button } from '@lightmap/ui';

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/**
 * Date picker with ±1 day steppers, "Now" (in the zone the planner shows times in) and a
 * day-of-year slider — scrub the seasons the way the timeline scrubs the day (plan §44 "scrub
 * through days, months, and seasons"); the time of day is kept.
 */
export function DateControl({
  disabled,
  blockedReason,
}: {
  disabled?: boolean;
  blockedReason?: string | null;
}) {
  const date = usePlannerStore((s) => s.date);
  const setDate = usePlannerStore((s) => s.setDate);
  const setNow = usePlannerStore((s) => s.setNow);
  const location = usePlannerStore((s) => s.location);
  const timeZoneMode = usePlannerStore((s) => s.timeZoneMode);
  const civil = parseCivilDate(date);
  const step = (n: number) => civil && setDate(civilDateString(addCivilDays(civil, n)));
  const doy = civil ? dayOfYear(civil) : 1;
  const yearDays = civil ? daysInYear(civil.year) : 365;
  const setDoy = (n: number) => civil && setDate(dateFromDayOfYear(civil.year, n));
  const human = civil
    ? new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : date;
  return (
    <div data-testid="date-control">
      <div className="mb-1 flex items-baseline justify-between">
        <label
          htmlFor="lm-date"
          className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]"
        >
          Date
        </label>
        <span className="text-xs text-[var(--lm-text-muted)]">
          {location ? effectiveTimeZone({ location, timeZoneMode }) : 'device time zone'}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="md"
          onClick={() => step(-1)}
          aria-label="Previous day"
          disabled={disabled}
        >
          ‹
        </Button>
        <input
          id="lm-date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          disabled={disabled}
          className="h-11 flex-1 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 text-sm text-[var(--lm-text)] focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
          aria-describedby={blockedReason ? 'lm-date-human lm-date-blocked' : 'lm-date-human'}
          data-testid="date-input"
        />
        <Button
          variant="ghost"
          size="md"
          onClick={() => step(1)}
          aria-label="Next day"
          disabled={disabled}
        >
          ›
        </Button>
        <Button
          variant="ghost"
          size="md"
          onClick={() => setNow()}
          title="Jump to now at this place"
        >
          Now
        </Button>
      </div>
      <p id="lm-date-human" className="mt-1 text-xs text-[var(--lm-text-muted)]">
        {human}
      </p>
      <div className="mt-1" data-testid="year-control">
        <input
          type="range"
          min={1}
          max={yearDays}
          step={1}
          value={doy}
          onChange={(e) => setDoy(Number(e.target.value))}
          disabled={disabled}
          className="lm-range w-full"
          aria-label={`Day of the year ${civil?.year ?? ''}`}
          aria-valuetext={human}
          title="Scrub the year: the time of day stays, the date moves"
          data-testid="year-range"
        />
        <div
          className="grid grid-cols-12 text-center text-[10px] leading-none text-[var(--lm-text-faint)]"
          aria-hidden
        >
          {MONTH_INITIALS.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      </div>
      <p id="lm-date-blocked" className="mt-1 text-xs text-[color:#ffd27a]" role="status">
        {blockedReason ?? ''}
      </p>
    </div>
  );
}

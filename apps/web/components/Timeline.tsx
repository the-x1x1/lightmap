'use client';
/**
 * The most important interaction (plan §4): a continuous scrubber across the local civil day with
 * sunrise, solar noon, golden hour, sunset, blue hour and night marked. Native range input for
 * keyboard/touch accessibility; astronomy updates on every tick (sub-millisecond), and the caller
 * debounces expensive renderer work.
 */
import { useId, useMemo } from 'react';
import type { DayEvents } from '@lightmap/astronomy';
import { formatWallTime } from '@lightmap/astronomy';
import { usePlannerStore } from '@/features/planner/store';
import { cx } from '@lightmap/ui';

export interface TimelineProps {
  dayEvents: DayEvents | null;
  timeZone: string;
  /** Current phase label for the aria description. */
  phase?: string | undefined;
  className?: string | undefined;
}

interface Marker {
  key: string;
  minutes: number;
  label: string;
  short: string;
  /** Single glyph for narrow screens (distinct per event kind, not colour-only). */
  glyph: string;
  tone: 'sun' | 'twilight' | 'muted';
}

function minutesOf(d: Date | null, dayStart: Date): number | null {
  if (!d) return null;
  return (d.getTime() - dayStart.getTime()) / 60_000;
}

export function dayMarkers(ev: DayEvents): Marker[] {
  const m = (
    key: string,
    d: Date | null,
    label: string,
    short: string,
    glyph: string,
    tone: Marker['tone'],
  ): Marker | null => {
    const mins = minutesOf(d, ev.dayStart);
    return mins === null ? null : { key, minutes: mins, label, short, glyph, tone };
  };
  return [
    m('dawn', ev.dawn, 'Civil dawn', 'Dawn', '◐', 'twilight'),
    m('sunrise', ev.sunrise, 'Sunrise', 'Rise', '↑', 'sun'),
    m('goldenEnd', ev.goldenHourMorningEnd, 'Golden hour ends', 'Golden', '✦', 'sun'),
    m('noon', ev.solarNoon, 'Solar noon', 'Noon', '☀', 'muted'),
    m('goldenStart', ev.goldenHourEveningStart, 'Golden hour begins', 'Golden', '✦', 'sun'),
    m('sunset', ev.sunset, 'Sunset', 'Set', '↓', 'sun'),
    m('dusk', ev.civilDusk, 'Civil dusk (blue hour ends)', 'Dusk', '◑', 'twilight'),
  ].filter((x): x is Marker => x !== null);
}

/** Gradient across the day: night → twilight → day → golden → night, from the event times. */
export function dayGradient(ev: DayEvents): string {
  const total = (ev.dayEnd.getTime() - ev.dayStart.getTime()) / 60_000;
  const pct = (d: Date | null) =>
    d ? `${((minutesOf(d, ev.dayStart)! / total) * 100).toFixed(2)}%` : null;
  if (ev.polar === 'midnight-sun') return 'linear-gradient(90deg, #6aa7e6, #8dbef0 50%, #6aa7e6)';
  if (ev.polar === 'polar-night')
    return ev.dawn
      ? `linear-gradient(90deg, #0c1230, #23305e ${pct(ev.dawn)}, #3a4f8a ${pct(ev.solarNoon) ?? '50%'}, #23305e ${pct(ev.civilDusk)}, #0c1230)`
      : 'linear-gradient(90deg, #0c1230, #141b3a, #0c1230)';
  const stops = [
    ['#0c1230', '0%'],
    ['#2b3a72', pct(ev.dawn)],
    ['#e79a4a', pct(ev.sunrise)],
    ['#8dbef0', pct(ev.goldenHourMorningEnd)],
    ['#9ccbf5', pct(ev.solarNoon)],
    ['#8dbef0', pct(ev.goldenHourEveningStart)],
    ['#e2833a', pct(ev.sunset)],
    ['#2b3a72', pct(ev.civilDusk)],
    ['#0c1230', '100%'],
  ].filter((s): s is [string, string] => s[1] !== null);
  return `linear-gradient(90deg, ${stops.map(([c, p]) => `${c} ${p}`).join(', ')})`;
}

export function Timeline({ dayEvents, timeZone, phase, className }: TimelineProps) {
  const minutes = usePlannerStore((s) => s.minutes);
  const setMinutes = usePlannerStore((s) => s.setMinutes);
  const id = useId();
  const total = dayEvents
    ? Math.round((dayEvents.dayEnd.getTime() - dayEvents.dayStart.getTime()) / 60_000)
    : 1440;
  const markers = useMemo(() => (dayEvents ? dayMarkers(dayEvents) : []), [dayEvents]);
  const gradient = useMemo(
    () => (dayEvents ? dayGradient(dayEvents) : 'rgba(255,255,255,0.15)'),
    [dayEvents],
  );
  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const timeLabel = `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;

  return (
    <div className={cx('w-full', className)} data-testid="timeline">
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Time
        </label>
        <output
          htmlFor={id}
          className="font-mono text-2xl tabular-nums"
          aria-live="off"
          data-testid="timeline-time"
        >
          {timeLabel}
        </output>
      </div>
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-90"
          style={{ background: gradient }}
        />
        <input
          id={id}
          type="range"
          className="lm-range relative"
          style={{ ['--lm-range-track' as string]: 'transparent' }}
          min={0}
          max={Math.min(total - 1, 1439)}
          step={1}
          value={Math.min(minutes, 1439)}
          onChange={(e) => setMinutes(Number(e.target.value))}
          onKeyDown={(e) => {
            // Page keys jump an hour; Home/End go to sunrise/sunset when known.
            if (e.key === 'PageUp') {
              e.preventDefault();
              setMinutes(minutes + 60);
            } else if (e.key === 'PageDown') {
              e.preventDefault();
              setMinutes(minutes - 60);
            } else if (e.key === 'Home' && dayEvents?.sunrise) {
              e.preventDefault();
              setMinutes(minutesOf(dayEvents.sunrise, dayEvents.dayStart)!);
            } else if (e.key === 'End' && dayEvents?.sunset) {
              e.preventDefault();
              setMinutes(minutesOf(dayEvents.sunset, dayEvents.dayStart)!);
            } else if (e.key === '[' || e.key === ']') {
              // Jump to the previous / next day event (dawn, golden hour, noon, dusk…), so every
              // marker is reachable from the keyboard, not only by mouse (plan §28).
              const sorted = markers.map((m) => m.minutes).sort((a, b) => a - b);
              const next =
                e.key === ']'
                  ? sorted.find((m) => m > minutes)
                  : [...sorted].reverse().find((m) => m < minutes);
              if (next !== undefined) {
                e.preventDefault();
                setMinutes(next);
              }
            }
          }}
          aria-valuetext={`${timeLabel}${phase ? `, ${phase.replace('-', ' ')}` : ''}`}
          aria-describedby={`${id}-desc`}
          data-testid="timeline-range"
        />
        <p id={`${id}-desc`} className="sr-only">
          Drag to scrub through the day. Arrow keys move one minute, Page Up and Page Down one hour
          {dayEvents?.sunrise && dayEvents.sunset
            ? ', Home jumps to sunrise, End to sunset'
            : dayEvents?.polar === 'midnight-sun'
              ? '; the sun is up all day here'
              : dayEvents?.polar === 'polar-night'
                ? '; the sun does not rise here today'
                : ''}
          {markers.length > 0 ? '. Square brackets jump to the previous or next event.' : '.'}
        </p>
        <div className="relative mt-0.5 h-8" aria-hidden>
          {markers.map((mk) => {
            const left = `${(mk.minutes / total) * 100}%`;
            return (
              <button
                key={mk.key}
                type="button"
                tabIndex={-1}
                title={`${mk.label} ${dayEvents ? formatWallTime(new Date(dayEvents.dayStart.getTime() + mk.minutes * 60_000), timeZone) : ''}`}
                onClick={() => setMinutes(mk.minutes)}
                className={cx(
                  'absolute min-w-6 -translate-x-1/2 text-[10px] leading-tight',
                  mk.tone === 'sun'
                    ? 'text-[var(--lm-sun)]'
                    : mk.tone === 'twilight'
                      ? 'text-[color:#9dbcff]'
                      : 'text-[var(--lm-text-faint)]',
                )}
                style={{ left }}
              >
                <span className="mx-auto block h-1.5 w-px bg-current" />
                <span className="hidden sm:block">{mk.short}</span>
                <span className="block sm:hidden">{mk.glyph}</span>
              </button>
            );
          })}
        </div>
      </div>
      {dayEvents?.notes.length ? (
        <p className="mt-1 text-xs text-[var(--lm-text-muted)]">{dayEvents.notes[0]}</p>
      ) : null}
    </div>
  );
}

export function DayEventMarkers({
  dayEvents,
  timeZone,
}: {
  dayEvents: DayEvents;
  timeZone: string;
}) {
  const rows: Array<[string, Date | null]> = [
    ['Civil dawn', dayEvents.dawn],
    ['Sunrise', dayEvents.sunrise],
    ['Golden hour (am)', dayEvents.goldenHourMorningEnd],
    ['Solar noon', dayEvents.solarNoon],
    ['Golden hour (pm)', dayEvents.goldenHourEveningStart],
    ['Sunset', dayEvents.sunset],
    ['Blue hour ends', dayEvents.civilDusk],
    ['Astronomical dusk', dayEvents.astronomicalDusk],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="day-events">
      {rows.map(([label, d]) => (
        <div key={label} className="flex justify-between gap-2 border-b border-white/5 py-1">
          <dt className="text-[var(--lm-text-muted)]">{label}</dt>
          <dd className="font-mono tabular-nums">{d ? formatWallTime(d, timeZone) : '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

'use client';
/**
 * Hourly forecast detail (Pro, `forecast_detail`): the day's fetched frames as one bar per local
 * hour — height is direct-light share, colour is the scenario class, a drop marks likely rain —
 * plus the "bright windows" a photographer scans for. Only rendered when frames exist for the day
 * (forecast, extended forecast or recent past); a scenario day shows nothing rather than a guess.
 * A visually hidden table carries the same numbers for assistive tech.
 */
import { useMemo } from 'react';
import { parseCivilDate, wallClockToUtc } from '@lightmap/astronomy';
import type { EntitlementDecision } from '@lightmap/entitlements';
import type { SceneState } from '@lightmap/scene';
import {
  brightWindows,
  hourlyOutlook,
  scenarioById,
  type OutlookHour,
  type WeatherFrame,
  type WeatherMode,
} from '@lightmap/weather';
import { cx } from '@lightmap/ui';
import { usePlannerStore } from '@/features/planner/store';
import { Paywall } from './Paywall';

const TONE: Record<OutlookHour['scenario'], string> = {
  clear: 'bg-[var(--lm-sun)]',
  'mostly-clear': 'bg-[color:#f2c46a]',
  'partly-cloudy': 'bg-[color:#9dbcff]',
  overcast: 'bg-[color:#8a8f99]',
  storm: 'bg-[color:#5b6a8f]',
};

export function HourlyOutlook({
  scene,
  frames,
  mode,
  decision,
}: {
  scene: SceneState;
  frames: readonly WeatherFrame[];
  mode: WeatherMode | null;
  decision: EntitlementDecision;
}) {
  const minutes = usePlannerStore((s) => s.minutes);
  const setMinutes = usePlannerStore((s) => s.setMinutes);
  const tz = scene.location.timeZone;
  const civil = parseCivilDate(scene.localTime.date);

  const hours = useMemo(() => {
    if (!civil || frames.length === 0) return [];
    // DST days: an hour may not exist (gap) — wallClockToUtc shifts forward; detect and drop it.
    return hourlyOutlook(frames, (h) => {
      const d = wallClockToUtc({ ...civil, hour: h, minute: 0, second: 0 }, tz);
      return Number.isNaN(d.getTime()) ? null : d;
    });
  }, [civil, frames, tz]);
  const windows = useMemo(() => brightWindows(hours), [hours]);

  if (frames.length === 0 || hours.length === 0) return null;

  const modeLabel =
    mode === 'EXTENDED_FORECAST'
      ? 'Extended forecast · low confidence'
      : mode === 'RECENT_PAST' || mode === 'PAST'
        ? 'Recent conditions'
        : 'Forecast';

  if (!decision.allowed)
    return (
      <details data-testid="hourly-outlook-locked">
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Hour by hour
          <span className="ml-2 normal-case tracking-normal text-[var(--lm-sun)]">Pro</span>
        </summary>
        <div className="mt-2">
          <Paywall
            compact
            reason={decision.reason ?? 'Hour-by-hour forecast detail is part of Pro.'}
          />
        </div>
      </details>
    );

  const selectedHour = Math.floor(minutes / 60);
  const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;

  return (
    <div className="space-y-1.5" data-testid="hourly-outlook">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Hour by hour
        </span>
        <span className="text-xs text-[var(--lm-text-muted)]">{modeLabel} · direct light</span>
      </div>
      <div
        className="flex h-16 items-end gap-px rounded-[var(--lm-radius-sm)] bg-white/5 px-1 pt-1"
        aria-hidden
      >
        {hours.map((h) => {
          const pct = Math.max(6, Math.round(h.directLightShare * 100));
          const rain =
            (h.precipitationProbability ?? 0) >= 40 || (h.precipitationAmount ?? 0) >= 0.5;
          return (
            <button
              key={h.hour}
              type="button"
              tabIndex={-1}
              onClick={() => setMinutes(h.hour * 60)}
              title={`${fmt(h.hour)} · ${scenarioById(h.scenario).label} · ${Math.round(h.cloudCoverTotal)} % cloud · ${Math.round(h.directLightShare * 100)} % direct${
                h.precipitationProbability !== null
                  ? ` · rain ${Math.round(h.precipitationProbability)} %`
                  : ''
              }`}
              className={cx(
                'group relative flex h-full flex-1 items-end rounded-sm',
                h.hour === selectedHour && 'ring-1 ring-inset ring-white/60',
              )}
            >
              <span
                className={cx('block w-full rounded-t-sm opacity-90', TONE[h.scenario])}
                style={{ height: `${pct}%` }}
              />
              {rain ? (
                <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[9px] leading-none text-[color:#9dbcff]">
                  ▾
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-[var(--lm-text-muted)]" aria-hidden>
        <span>{fmt(hours[0]!.hour)}</span>
        <span>{fmt(hours[Math.floor(hours.length / 2)]!.hour)}</span>
        <span>{fmt(hours[hours.length - 1]!.hour)}</span>
      </div>
      <p className="text-xs text-[var(--lm-text-muted)]" data-testid="bright-windows">
        {windows.length === 0
          ? 'No hour reaches 60 % direct light in this outlook.'
          : `Best light: ${windows
              .map(
                (w) =>
                  `${fmt(w.fromHour)}–${fmt(w.toHour + 1)} (${Math.round(w.meanDirect * 100)} % direct)`,
              )
              .join(', ')}. Cloud only — the sun's own height is on the timeline.`}
      </p>
      {/* Same numbers for assistive tech and for anyone who prefers a table. */}
      <details>
        <summary className="cursor-pointer text-xs text-[var(--lm-text-muted)]">
          Show as table
        </summary>
        <table className="mt-1 w-full text-xs">
          <caption className="sr-only">Hourly outlook for {scene.localTime.date}</caption>
          <thead>
            <tr className="text-left text-[var(--lm-text-muted)]">
              <th scope="col" className="py-0.5 font-normal">
                Hour
              </th>
              <th scope="col" className="py-0.5 font-normal">
                Condition
              </th>
              <th scope="col" className="py-0.5 text-right font-normal">
                Cloud
              </th>
              <th scope="col" className="py-0.5 text-right font-normal">
                Direct
              </th>
              <th scope="col" className="py-0.5 text-right font-normal">
                Rain
              </th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h.hour} className="border-t border-white/5">
                <th scope="row" className="py-0.5 font-mono font-normal tabular-nums">
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => setMinutes(h.hour * 60)}
                  >
                    {fmt(h.hour)}
                  </button>
                </th>
                <td className="py-0.5">{scenarioById(h.scenario).label}</td>
                <td className="py-0.5 text-right font-mono tabular-nums">
                  {Math.round(h.cloudCoverTotal)} %
                </td>
                <td className="py-0.5 text-right font-mono tabular-nums">
                  {Math.round(h.directLightShare * 100)} %
                </td>
                <td className="py-0.5 text-right font-mono tabular-nums">
                  {h.precipitationProbability !== null
                    ? `${Math.round(h.precipitationProbability)} %`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

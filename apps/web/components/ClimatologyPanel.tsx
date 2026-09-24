'use client';
/**
 * "Typical for this month" (plan §25 Phase 7; WEATHER_AND_FORECAST_MODEL.md §8). Shows how often
 * each scenario class occurred in daylight hours over the last ten years for this month and place.
 * It may suggest which scenario to look at first and lets the user pick one explicitly; it never
 * selects one silently and is never called a forecast.
 */
import {
  SCENARIOS,
  daylightPattern,
  suggestedScenario,
  type ClimatologySummary,
} from '@lightmap/weather';
import { useId } from 'react';
import type { SceneState } from '@lightmap/scene';
import type { EntitlementDecision } from '@lightmap/entitlements';
import { Badge, cx } from '@lightmap/ui';
import { usePlannerStore } from '@/features/planner/store';
import { useClimatology } from '@/features/planner/use-climatology';
import { Paywall } from './Paywall';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function ClimatologyPanel({
  scene,
  decision,
}: {
  scene: SceneState;
  decision: EntitlementDecision;
}) {
  const month = Number(scene.localTime.date.slice(5, 7));
  const setScenario = usePlannerStore((s) => s.setScenario);
  const q = useClimatology(scene.location, month, decision.allowed);
  const monthName = MONTHS[month - 1] ?? '';
  const hourTableId = useId();
  const selectedHour = Number(scene.localTime.time.slice(0, 2));

  if (!decision.allowed)
    return (
      <details data-testid="climatology-locked">
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Typical for {monthName}
          <span className="ml-2 normal-case tracking-normal text-[var(--lm-sun)]">Pro</span>
        </summary>
        <div className="mt-2">
          <Paywall
            compact
            reason={
              decision.reason ??
              'Typical conditions for any month — ten years of climate data — are part of Pro.'
            }
          />
        </div>
      </details>
    );

  return (
    <div className="space-y-1.5" data-testid="climatology">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Typical for {monthName}
        </span>
        <span role="status">
          <Badge tone="twilight" icon="≈" title="A distribution over past years, not a prediction.">
            Climatology · not a forecast
          </Badge>
        </span>
      </div>
      {q.isLoading ? (
        <p className="text-xs text-[var(--lm-text-muted)]" role="status">
          Summarising ten years of {monthName} days…
        </p>
      ) : null}
      {q.isError ? (
        <p className="text-xs text-[var(--lm-text-muted)]" role="status">
          Typical conditions are unavailable right now. Scenarios still work.
        </p>
      ) : null}
      {q.data ? (
        <>
          <ul className="flex flex-wrap gap-1.5" aria-label="Share of daylight hours by condition">
            {SCENARIOS.map((sc) => {
              const share = q.data.summary.scenarioShare[sc.id] ?? 0;
              const suggested = suggestedScenario(q.data.summary) === sc.id;
              return (
                <li key={sc.id}>
                  <button
                    type="button"
                    onClick={() => setScenario(sc.id, true)}
                    className={cx(
                      'flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs ring-1 ring-inset',
                      suggested
                        ? 'bg-white/10 ring-white/25'
                        : 'bg-white/5 ring-white/10 hover:bg-white/10',
                    )}
                    title={`Compare the ${sc.label} scenario`}
                    data-testid={`climatology-${sc.id}`}
                  >
                    <span>{sc.label}</span>
                    <span className="font-mono tabular-nums text-[var(--lm-text)]">
                      {Math.round(share * 100)} %
                    </span>
                    {suggested ? <span className="sr-only"> (most common)</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <HourOfDay
            byHour={q.data.summary.byHour}
            window={q.data.summary.window}
            selectedHour={selectedHour}
            tableId={hourTableId}
          />
          <p className="text-xs text-[var(--lm-text-muted)]" data-testid="climatology-summary">
            Daylight hours ({q.data.summary.window.startHour}:00–{q.data.summary.window.endHour}
            :00), {q.data.summary.years.from}–{q.data.summary.years.to}, ~
            {Math.round(q.data.summary.meanCloudCover)} % mean cloud, rain on{' '}
            {Math.round(q.data.summary.wetDayShare * 100)} % of days. Tap a condition to compare
            that scenario — history, not a prediction for your date.
            {q.data.isFixture ? ' Development fixture data.' : ''}
          </p>
          <p className="text-[10px] text-[var(--lm-text-faint)]">{q.data.summary.attribution}</p>
        </>
      ) : null}
    </div>
  );
}

const two = (h: number) => `${h.toString().padStart(2, '0')}:00`;

/**
 * Typical cloud by local hour of day: 24 bars (height = mean cloud, tone = share of clear hours)
 * with the selected hour marked, a one-line pattern when the day has one, and a table for
 * assistive tech. Night hours are drawn dimmer; the headline shares above use daylight only.
 */
function HourOfDay({
  byHour,
  window,
  selectedHour,
  tableId,
}: {
  byHour: ClimatologySummary['byHour'];
  window: ClimatologySummary['window'];
  selectedHour: number;
  tableId: string;
}) {
  const pattern = daylightPattern({ byHour }, window);
  if (byHour.every((b) => b.samples === 0)) return null;
  return (
    <div className="space-y-1" data-testid="climatology-hours">
      <div
        className="flex h-12 items-end gap-px"
        role="img"
        aria-label="Typical cloud cover by hour of day"
        aria-describedby={tableId}
      >
        {byHour.map((b) => {
          const night = b.hour < window.startHour || b.hour >= window.endHour;
          const h = b.samples === 0 ? 0 : Math.max(4, Math.round(b.meanCloudCover));
          return (
            <span
              key={b.hour}
              className={cx(
                'relative flex-1 rounded-t-sm',
                b.hour === selectedHour ? 'ring-1 ring-[var(--lm-sun)]' : null,
                night ? 'opacity-40' : null,
              )}
              style={{
                height: `${h}%`,
                background:
                  b.samples === 0
                    ? 'transparent'
                    : `color-mix(in srgb, #dfe6f0 ${Math.round(b.clearShare * 100)}%, #6b7280)`,
              }}
              title={
                b.samples === 0
                  ? `${two(b.hour)}: no data`
                  : `${two(b.hour)}: ${Math.round(b.meanCloudCover)} % mean cloud, clear ${Math.round(b.clearShare * 100)} % of the time`
              }
            />
          );
        })}
      </div>
      <div
        aria-hidden
        className="flex justify-between font-mono text-[10px] text-[var(--lm-text-faint)]"
      >
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <p className="text-xs text-[var(--lm-text-muted)]" data-testid="climatology-pattern">
        {pattern
          ? `Typically clearest ${two(pattern.clearest.from)}–${two(pattern.clearest.to)} (~${Math.round(pattern.clearest.meanCloudCover)} % cloud), cloudiest ${two(pattern.dullest.from)}–${two(pattern.dullest.to)} (~${Math.round(pattern.dullest.meanCloudCover)} %).`
          : 'No strong time-of-day pattern in this month.'}
      </p>
      <table id={tableId} className="sr-only">
        <caption>Typical cloud cover by local hour of day</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Mean cloud %</th>
            <th scope="col">Clear share %</th>
            <th scope="col">Wet share %</th>
          </tr>
        </thead>
        <tbody>
          {byHour.map((b) => (
            <tr key={b.hour}>
              <th scope="row">{two(b.hour)}</th>
              <td>{b.samples === 0 ? '—' : Math.round(b.meanCloudCover)}</td>
              <td>{b.samples === 0 ? '—' : Math.round(b.clearShare * 100)}</td>
              <td>{b.samples === 0 ? '—' : Math.round(b.wetShare * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

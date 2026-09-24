'use client';
/**
 * "Typical for this month" (plan §25 Phase 7; WEATHER_AND_FORECAST_MODEL.md §8). Shows how often
 * each scenario class occurred in daylight hours over the last ten years for this month and place.
 * It may suggest which scenario to look at first and lets the user pick one explicitly; it never
 * selects one silently and is never called a forecast.
 */
import { SCENARIOS, suggestedScenario } from '@lightmap/weather';
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

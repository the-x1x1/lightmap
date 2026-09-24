'use client';
/**
 * Scenario selector (plan §4). Inside the forecast window the forecast comes first and the user
 * may still compare scenarios; outside it, scenarios are the only option and are labelled as such.
 */
import { SCENARIOS, type WeatherScenarioId } from '@lightmap/weather';
import type { SceneState } from '@lightmap/scene';
import { usePlannerStore } from '@/features/planner/store';
import { cx, useRovingRadio } from '@lightmap/ui';
import { ForecastBadge } from './ForecastBadge';

const ICONS: Record<WeatherScenarioId, string> = {
  clear: '☀',
  'mostly-clear': '🌤',
  'partly-cloudy': '⛅',
  overcast: '☁',
  storm: '🌧',
};

export function WeatherScenarioPicker({
  scene,
  weatherLoading,
}: {
  scene: SceneState;
  weatherLoading: boolean;
}) {
  const scenario = usePlannerStore((s) => s.scenario);
  const forceScenario = usePlannerStore((s) => s.forceScenario);
  const setScenario = usePlannerStore((s) => s.setScenario);
  const setForceScenario = usePlannerStore((s) => s.setForceScenario);
  const forecastAvailable =
    scene.atmosphere.mode !== 'SCENARIO' ||
    (forceScenario &&
      scene.atmosphere.frame === null &&
      scene.confidence.notes.weather.startsWith('You are comparing'));
  const showingForecast = scene.atmosphere.mode !== 'SCENARIO';
  const hasForecastItem = forecastAvailable || showingForecast;
  // Items: [forecast?] + scenarios; one Tab stop, arrow keys move the choice (plan §28).
  const count = SCENARIOS.length + (hasForecastItem ? 1 : 0);
  const selectedIndex = showingForecast
    ? 0
    : SCENARIOS.findIndex((x) => x.id === scenario) + (hasForecastItem ? 1 : 0);
  const roving = useRovingRadio(count, selectedIndex, (i) => {
    if (hasForecastItem && i === 0) setForceScenario(false);
    else {
      const sc = SCENARIOS[i - (hasForecastItem ? 1 : 0)];
      if (sc) setScenario(sc.id, true);
    }
  });

  return (
    <div data-testid="scenario-picker">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          {showingForecast ? 'Weather' : 'Weather scenario'}
        </span>
        <span role="status">
          <ForecastBadge scene={scene} loading={weatherLoading} />
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Weather scenario"
        className="lm-scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {forecastAvailable || showingForecast ? (
          <button
            type="button"
            role="radio"
            aria-checked={showingForecast}
            {...roving(0)}
            onClick={() => setForceScenario(false)}
            className={cx(
              'flex h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 text-sm ring-1 ring-inset',
              showingForecast
                ? 'bg-[var(--lm-sun)] text-[#1a1200] ring-transparent'
                : 'bg-white/8 text-[var(--lm-text)] ring-white/10 hover:bg-white/12',
            )}
            data-testid="scenario-forecast"
          >
            <span aria-hidden>◉</span> Forecast
          </button>
        ) : null}
        {SCENARIOS.map((s, i) => {
          const selected = !showingForecast && scenario === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              {...roving(i + (hasForecastItem ? 1 : 0))}
              title={s.hint}
              onClick={() => setScenario(s.id, true)}
              className={cx(
                'flex h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 text-sm ring-1 ring-inset',
                selected
                  ? 'bg-[var(--lm-text)] text-[var(--lm-chrome)] ring-transparent'
                  : 'bg-white/8 text-[var(--lm-text)] ring-white/10 hover:bg-white/12',
              )}
              data-testid={`scenario-${s.id}`}
            >
              <span aria-hidden>{ICONS[s.id]}</span> {s.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-[var(--lm-text-muted)]" data-testid="scenario-summary">
        {scene.atmosphere.summary}
      </p>
    </div>
  );
}

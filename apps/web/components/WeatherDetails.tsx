'use client';
import { fieldConditions, formatVisibility, type SceneState } from '@lightmap/scene';
import { describeWeatherCode } from '@lightmap/weather';
import { useMemo } from 'react';
import { usePlannerStore } from '@/features/planner/store';

export function WeatherDetails({ scene }: { scene: SceneState }) {
  const a = scene.atmosphere;
  const f = a.frame;
  const p = a.parameters;
  const units = usePlannerStore((s) => s.units);
  const sunEl = scene.solar.elevationDegrees;
  // Wind on the tripod, dew or fog on the glass — from the frame's own fields (none for a scenario).
  const field = useMemo(() => fieldConditions(f, sunEl, units), [f, sunEl, units]);
  const observed = a.mode === 'RECENT_PAST' || a.mode === 'PAST';
  return (
    <div className="space-y-2 text-sm" data-testid="weather-details">
      <p className="text-[var(--lm-text-muted)]">{a.summary}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Row label="Cloud cover" value={`${Math.round(p.cloudCover * 100)} %`} />
        <Row label="Direct light" value={`${Math.round(p.sunTransmittance * 100)} %`} />
        <Row label="Diffuse share" value={`${Math.round(p.diffuseFraction * 100)} %`} />
        <Row label="Haze" value={`${Math.round(p.haze * 100)} %`} />
        {f ? <Row label="Conditions" value={describeWeatherCode(f.weatherCode)} /> : null}
        {observed && f?.precipitationAmount !== null && f?.precipitationAmount !== undefined ? (
          // A past hour has what fell, not a chance of it.
          <Row label="Rain" value={rainAmount(f.precipitationAmount, units)} />
        ) : f?.precipitationProbability !== null && f?.precipitationProbability !== undefined ? (
          <Row label="Rain chance" value={`${Math.round(f.precipitationProbability)} %`} />
        ) : null}
        {f?.visibility !== null && f?.visibility !== undefined ? (
          <Row label="Visibility" value={formatVisibility(f.visibility, units)} />
        ) : null}
        {field.map((line) => (
          <Row key={line.label} label={line.label} value={line.value} />
        ))}
      </dl>
      {field.some((line) => line.note) ? (
        <ul className="space-y-1 text-xs text-[var(--lm-text-muted)]" data-testid="field-notes">
          {field.map((line) =>
            line.note ? (
              <li key={line.label}>
                <span className="text-[var(--lm-text)]">{line.label}:</span> {line.note}
              </li>
            ) : null,
          )}
        </ul>
      ) : null}
      {a.providerAttribution ? (
        <p className="text-xs text-[var(--lm-text-faint)]">{a.providerAttribution}</p>
      ) : null}
    </div>
  );
}

/** What fell in the hour: "none", "0.4 mm", or in inches. */
function rainAmount(mm: number, units: 'metric' | 'imperial'): string {
  if (mm < 0.05) return 'none in the hour';
  return units === 'imperial'
    ? `${(mm / 25.4).toFixed(2)} in in the hour`
    : `${mm.toFixed(1)} mm in the hour`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-white/5 py-1">
      <dt className="text-[var(--lm-text-muted)]">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

'use client';
import { M_PER_MI, type SceneState } from '@lightmap/scene';
import { describeWeatherCode } from '@lightmap/weather';
import { usePlannerStore } from '@/features/planner/store';

const MPH_PER_MPS = 3600 / M_PER_MI;

export function WeatherDetails({ scene }: { scene: SceneState }) {
  const a = scene.atmosphere;
  const f = a.frame;
  const p = a.parameters;
  const imperial = usePlannerStore((s) => s.units) === 'imperial';
  return (
    <div className="space-y-2 text-sm" data-testid="weather-details">
      <p className="text-[var(--lm-text-muted)]">{a.summary}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Row label="Cloud cover" value={`${Math.round(p.cloudCover * 100)} %`} />
        <Row label="Direct light" value={`${Math.round(p.sunTransmittance * 100)} %`} />
        <Row label="Diffuse share" value={`${Math.round(p.diffuseFraction * 100)} %`} />
        <Row label="Haze" value={`${Math.round(p.haze * 100)} %`} />
        {f ? <Row label="Conditions" value={describeWeatherCode(f.weatherCode)} /> : null}
        {f?.precipitationProbability !== null && f?.precipitationProbability !== undefined ? (
          <Row label="Rain chance" value={`${Math.round(f.precipitationProbability)} %`} />
        ) : null}
        {f?.visibility !== null && f?.visibility !== undefined ? (
          <Row
            label="Visibility"
            value={
              imperial
                ? `${(f.visibility / M_PER_MI).toFixed(0)} mi`
                : `${(f.visibility / 1000).toFixed(0)} km`
            }
          />
        ) : null}
        {f?.windSpeed !== null && f?.windSpeed !== undefined ? (
          <Row
            label="Wind"
            value={
              imperial
                ? `${(f.windSpeed * MPH_PER_MPS).toFixed(0)} mph`
                : `${f.windSpeed.toFixed(0)} m/s`
            }
          />
        ) : null}
      </dl>
      {a.providerAttribution ? (
        <p className="text-xs text-[var(--lm-text-faint)]">{a.providerAttribution}</p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-white/5 py-1">
      <dt className="text-[var(--lm-text-muted)]">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

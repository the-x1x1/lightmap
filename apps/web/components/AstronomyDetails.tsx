'use client';
import type { SceneState } from '@lightmap/scene';
import { explainScene } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { formatWallTime } from '@lightmap/astronomy';
import { DayEventMarkers } from './Timeline';

export function AstronomyDetails({ scene }: { scene: SceneState }) {
  const s = scene.solar;
  const tz = scene.location.timeZone;
  return (
    <div className="space-y-3" data-testid="astronomy-details">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label="Sun elevation" value={`${s.elevationDegrees.toFixed(1)}°`} testId="sun-elevation" />
        <Row label="Sun azimuth" value={`${s.azimuthDegrees.toFixed(1)}° ${compassLabel(s.azimuthDegrees)}`} testId="sun-azimuth" />
        <Row label="Sunrise" value={scene.dayEvents.sunrise ? formatWallTime(scene.dayEvents.sunrise, tz) : '—'} testId="sunrise" />
        <Row label="Sunset" value={scene.dayEvents.sunset ? formatWallTime(scene.dayEvents.sunset, tz) : '—'} testId="sunset" />
        <Row label="Phase" value={s.phase.replace('-', ' ')} />
        <Row label="Solar time" value={`${Math.floor(s.solarTime).toString().padStart(2, '0')}:${Math.round((s.solarTime % 1) * 60).toString().padStart(2, '0')}`} />
        <Row label="Colour temp." value={`${Math.round(scene.atmosphere.colorTemperatureK)} K`} />
        <Row label="Daylight" value={`${Math.floor(scene.dayEvents.daylightMinutes / 60)} h ${Math.round(scene.dayEvents.daylightMinutes % 60)} min`} />
      </dl>
      <details className="group">
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">All day events</summary>
        <div className="mt-2"><DayEventMarkers dayEvents={scene.dayEvents} timeZone={tz} /></div>
      </details>
      {scene.lunar ? (
        <details className="group" data-testid="moon-details">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">Moon</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Phase" value={`${scene.lunar.phaseName} · ${Math.round(scene.lunar.illuminatedFraction * 100)} %`} />
            <Row label="Elevation" value={`${scene.lunar.elevationDegrees.toFixed(1)}°`} />
            <Row label="Azimuth" value={`${scene.lunar.azimuthDegrees.toFixed(0)}° ${compassLabel(scene.lunar.azimuthDegrees)}`} />
            <Row label="Moonrise / set" value={`${scene.lunar.moonrise ? formatWallTime(scene.lunar.moonrise, tz) : '—'} / ${scene.lunar.moonset ? formatWallTime(scene.lunar.moonset, tz) : '—'}`} />
          </dl>
          <p className="mt-1 text-xs text-[var(--lm-text-faint)]">{scene.lunar.accuracyNote}</p>
        </details>
      ) : null}
      <details className="group" data-testid="why-panel">
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">Why does it look like this?</summary>
        <ul className="mt-2 space-y-1 text-sm">
          {explainScene(scene).map((l) => (
            <li key={l.label} className="flex justify-between gap-3 border-b border-white/5 py-1">
              <span className="text-[var(--lm-text-muted)]">{l.label}</span>
              <span className="text-right">{l.value}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-white/5 py-1">
      <dt className="text-[var(--lm-text-muted)]">{label}</dt>
      <dd className="font-mono tabular-nums" data-testid={testId}>{value}</dd>
    </div>
  );
}

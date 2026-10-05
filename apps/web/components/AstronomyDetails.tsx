'use client';
import type { SceneState } from '@lightmap/scene';
import { explainScene, formatDeg, type SeasonalEnvelope } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { formatWallTime } from '@lightmap/astronomy';
import { useSeasonalEnvelope } from '@/features/planner/use-seasonal';
import { DayEventMarkers } from './Timeline';

/** "64°–115° (ENE–ESE)" for a clockwise bearing range. */
function bearingRange(r: [number, number]): string {
  return `${Math.round(r[0])}°–${Math.round(r[1])}° (${compassLabel(r[0])}–${compassLabel(r[1])})`;
}

/** One line on where sunrise and sunset swing to over the year, and how high noon gets. */
export function describeSeasons(e: SeasonalEnvelope): string {
  const noon = `noon ${e.noonRange[0].toFixed(0)}°–${e.noonRange[1].toFixed(0)}°`;
  if (!e.sunriseRange || !e.sunsetRange) {
    const polar = [
      e.june.polar !== 'normal' ? `June: ${e.june.polar.replace('-', ' ')}` : null,
      e.december.polar !== 'normal' ? `December: ${e.december.polar.replace('-', ' ')}` : null,
    ]
      .filter((x) => x !== null)
      .join(', ');
    return `${polar}; ${noon}`;
  }
  return `Sunrise ${bearingRange(e.sunriseRange)}, sunset ${bearingRange(e.sunsetRange)}, ${noon}`;
}

export function AstronomyDetails({ scene }: { scene: SceneState }) {
  const s = scene.solar;
  const tz = scene.timeZone;
  const seasons = useSeasonalEnvelope(scene);
  return (
    <div className="space-y-3" data-testid="astronomy-details">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row
          label="Sun elevation"
          value={`${s.elevationDegrees.toFixed(1)}°`}
          testId="sun-elevation"
        />
        <Row
          label="Sun azimuth"
          value={`${s.azimuthDegrees.toFixed(1)}° ${compassLabel(s.azimuthDegrees)}`}
          testId="sun-azimuth"
        />
        <Row
          label="Sunrise"
          value={scene.dayEvents.sunrise ? formatWallTime(scene.dayEvents.sunrise, tz) : '—'}
          testId="sunrise"
        />
        <Row
          label="Sunset"
          value={scene.dayEvents.sunset ? formatWallTime(scene.dayEvents.sunset, tz) : '—'}
          testId="sunset"
        />
        {scene.terrainHorizon?.sunEvents.differsFromAstronomical ? (
          <>
            <Row
              label="First light over terrain"
              value={
                scene.terrainHorizon.sunEvents.firstLight
                  ? formatWallTime(scene.terrainHorizon.sunEvents.firstLight, tz)
                  : scene.terrainHorizon.sunEvents.startsVisible
                    ? 'up at midnight'
                    : 'never today'
              }
              testId="terrain-first-light"
            />
            <Row
              label="Last light over terrain"
              value={
                scene.terrainHorizon.sunEvents.lastLight
                  ? formatWallTime(scene.terrainHorizon.sunEvents.lastLight, tz)
                  : scene.terrainHorizon.sunEvents.endsVisible
                    ? 'still up at midnight'
                    : 'never today'
              }
              testId="terrain-last-light"
            />
          </>
        ) : null}
        {scene.terrainHorizon ? (
          <Row
            label="Terrain horizon at sun"
            value={`${formatDeg(scene.terrainHorizon.horizonAtSunDeg)}° (sun's upper limb ${formatDeg(scene.solar.apparentElevationDegrees + 0.27)}°)`}
            testId="terrain-horizon-at-sun"
          />
        ) : null}
        <Row label="Phase" value={s.phase.replace('-', ' ')} />
        <Row
          label="Solar time"
          value={`${Math.floor(s.solarTime).toString().padStart(2, '0')}:${Math.round(
            (s.solarTime % 1) * 60,
          )
            .toString()
            .padStart(2, '0')}`}
        />
        <Row label="Colour temp." value={`${Math.round(scene.atmosphere.colorTemperatureK)} K`} />
        <Row
          label="Daylight"
          value={`${Math.floor(scene.dayEvents.daylightMinutes / 60)} h ${Math.round(scene.dayEvents.daylightMinutes % 60)} min`}
        />
      </dl>
      {scene.terrainHorizon ? (
        <p className="text-xs text-[var(--lm-text-muted)]" data-testid="terrain-caveat">
          {scene.terrainHorizon.profile.caveat}
        </p>
      ) : null}
      <p className="text-xs text-[var(--lm-text-muted)]" data-testid="seasonal-envelope">
        <span className="uppercase tracking-wide">Across the year</span> ·{' '}
        {describeSeasons(seasons)}
        {' — '}
        the June and December solstices bound every other day here.
      </p>
      <details className="group">
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          All day events
        </summary>
        <div className="mt-2">
          <DayEventMarkers dayEvents={scene.dayEvents} timeZone={tz} />
        </div>
      </details>
      {scene.lunar ? (
        <details className="group" data-testid="moon-details">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
            Moon
          </summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row
              label="Phase"
              value={`${scene.lunar.phaseName} · ${Math.round(scene.lunar.illuminatedFraction * 100)} %`}
            />
            <Row
              label="Elevation"
              value={`${scene.lunar.elevationDegrees.toFixed(1)}°${
                scene.terrainHorizon?.moonAboveTerrain === false && scene.lunar.isAboveHorizon
                  ? ' · behind terrain'
                  : ''
              }`}
            />
            <Row
              label="Azimuth"
              value={`${scene.lunar.azimuthDegrees.toFixed(0)}° ${compassLabel(scene.lunar.azimuthDegrees)}`}
            />
            <Row
              label="Moonrise / set"
              value={`${scene.lunar.moonrise ? formatWallTime(scene.lunar.moonrise, tz) : '—'} / ${scene.lunar.moonset ? formatWallTime(scene.lunar.moonset, tz) : '—'}`}
            />
          </dl>
          <p className="mt-1 text-xs text-[var(--lm-text-muted)]">{scene.lunar.accuracyNote}</p>
        </details>
      ) : null}
      <details className="group" data-testid="why-panel">
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Why does it look like this?
        </summary>
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
      <dd className="font-mono tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

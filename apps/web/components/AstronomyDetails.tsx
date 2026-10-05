'use client';
import type { SceneState } from '@lightmap/scene';
import { describeSeasonalEnvelope, explainScene, formatDeg } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import {
  describeMilkyWayWindows,
  formatMilkyWayWindow,
  formatWallTime,
  milkyWayWindows,
  nextMoonPhases,
  utcToLocalSelection,
  utcToWallClock,
  type MilkyWayCoreState,
} from '@lightmap/astronomy';
import { useMemo, useState } from 'react';
import { usePlannerStore } from '@/features/planner/store';
import { useSeasonalEnvelope } from '@/features/planner/use-seasonal';
import { DayEventMarkers } from './Timeline';

/** How far ahead the dark-window scan looks: a lunation and a half, so a Moon-free run is always inside it. */
export const DARK_WINDOW_NIGHTS = 45;

const PHASE_LABEL = {
  new: 'New',
  'first-quarter': 'First quarter',
  full: 'Full',
  'last-quarter': 'Last quarter',
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "36° up SSW — Astronomical night, core 36° up, Moon down" / "below the horizon — …". */
export function describeMilkyWay(n: MilkyWayCoreState): string {
  const where =
    n.elevationDeg > 0
      ? `${Math.round(n.elevationDeg)}° up ${compassLabel(n.azimuthDeg)}`
      : 'below the horizon';
  return `${where} — ${n.reason}`;
}

/** "Full 31 May · Last quarter 8 Jun · New 15 Jun · First quarter 21 Jun" in the planning zone. */
export function describeNextPhases(from: Date, timeZone: string): string {
  return nextMoonPhases(from, 4)
    .map((e) => {
      const w = utcToWallClock(e.at, timeZone);
      return `${PHASE_LABEL[e.phase]} ${w.day} ${MONTHS[w.month - 1] ?? ''}`;
    })
    .join(' · ');
}

/**
 * The nights ahead on which the core can be shot, each a click away (the planner jumps to the
 * core's highest instant inside the window). Rendered only while the Moon details are open: the
 * 45-night scan is a few tens of milliseconds and is memoised per place and civil day.
 */
function DarkWindows({ scene }: { scene: SceneState }) {
  const setDate = usePlannerStore((s) => s.setDate);
  const setMinutes = usePlannerStore((s) => s.setMinutes);
  const tz = scene.timeZone;
  const lat = scene.location.point.latitude;
  const lng = scene.location.point.longitude;
  const from = scene.dayEvents.dayStart.getTime();
  const result = useMemo(
    () => milkyWayWindows(new Date(from), DARK_WINDOW_NIGHTS, lat, lng),
    [from, lat, lng],
  );
  const shown = result.windows.slice(0, 3);
  const more = result.windows.length - shown.length;
  const jump = (at: Date) => {
    const sel = utcToLocalSelection(at, tz);
    setDate(sel.date);
    setMinutes(sel.minutes);
  };
  return (
    <p
      className="mt-1 text-xs text-[var(--lm-text-muted)]"
      data-testid="milky-way-windows"
      data-count={result.windows.length}
      data-reason={result.reason}
    >
      Dark windows ahead:{' '}
      {shown.length === 0
        ? describeMilkyWayWindows(result, tz)
        : shown.map((w, i) => (
            <span key={w.start.getTime()}>
              {i > 0 ? ' · ' : ''}
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2 hover:text-[var(--lm-text)]"
                title="Jump the planner to the core's highest point in this window"
                onClick={() => jump(w.peakAt)}
              >
                {formatMilkyWayWindow(w, tz)}
              </button>
            </span>
          ))}
      {more > 0 ? ` · ${more} more in ${result.days} nights` : ''}
    </p>
  );
}

export function AstronomyDetails({ scene }: { scene: SceneState }) {
  const s = scene.solar;
  const tz = scene.timeZone;
  const seasons = useSeasonalEnvelope(scene);
  const [moonOpen, setMoonOpen] = useState(false);
  // The next four principal phases from the selected day (night planning): per civil day.
  const phaseFrom = scene.dayEvents.dayStart.getTime();
  const hasMoon = scene.lunar !== null;
  const nextPhases = useMemo(
    () => (hasMoon ? describeNextPhases(new Date(phaseFrom), tz) : ''),
    [hasMoon, phaseFrom, tz],
  );
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
        {describeSeasonalEnvelope(seasons)}
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
        <details
          className="group"
          data-testid="moon-details"
          onToggle={(e) => setMoonOpen(e.currentTarget.open)}
        >
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
          <p className="mt-1 text-xs text-[var(--lm-text-muted)]" data-testid="moon-next-phases">
            Next: {nextPhases}
          </p>
          {scene.nightSky ? (
            <p
              className={
                scene.nightSky.verdict === 'visible'
                  ? 'mt-1 text-xs text-[var(--lm-ok)]'
                  : 'mt-1 text-xs text-[var(--lm-text-muted)]'
              }
              data-testid="milky-way"
              data-verdict={scene.nightSky.verdict}
            >
              Milky Way core: {describeMilkyWay(scene.nightSky)}
            </p>
          ) : null}
          {scene.nightSky && moonOpen ? <DarkWindows scene={scene} /> : null}
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

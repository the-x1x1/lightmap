'use client';
import type { SceneState } from '@lightmap/scene';
import { describeSeasonalEnvelope, explainScene, formatDeg } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import {
  civilDateString,
  describeMilkyWayWindows,
  formatMilkyWayWindow,
  formatWallTime,
  milkyWayWindows,
  utcToLocalSelection,
  utcToWallClock,
  type LunarState,
} from '@lightmap/astronomy';
import { useMemo, useState } from 'react';
import { usePlannerStore } from '@/features/planner/store';
import { useSettled } from '@/lib/use-settled';
import {
  DARK_WINDOW_NIGHTS,
  describeMilkyWay,
  describeNextPhases,
} from '@/features/planner/night-text';
import { useSeasonalEnvelope } from '@/features/planner/use-seasonal';
import { describeLightWindows } from '@/features/planner/light-windows';
import { DayEventMarkers } from './Timeline';

/**
 * The nights ahead on which the core can be shot, each a click away (the planner jumps to the
 * core's highest instant inside the window). Rendered only while the Moon details are open: the
 * 45-night scan is a few tens of milliseconds and is memoised per place and civil day.
 */
function DarkWindows({ scene, windowEnd }: { scene: SceneState; windowEnd: string | null }) {
  const setDate = usePlannerStore((s) => s.setDate);
  const setMinutes = usePlannerStore((s) => s.setMinutes);
  const tz = scene.timeZone;
  const lat = scene.location.point.latitude;
  const lng = scene.location.point.longitude;
  // From the selected day's noon, so the scan starts with the night that begins that evening
  // and no night is split by its edges; the day settles first (the year slider is continuous).
  const from = useSettled(scene.dayEvents.dayStart.getTime() + 12 * 3_600_000, 300);
  const result = useMemo(
    () => milkyWayWindows(new Date(from), DARK_WINDOW_NIGHTS, lat, lng),
    [from, lat, lng],
  );
  // A Free plan sees the nights inside its date window and an honest count beyond it (plan §38:
  // explain, never leak the Pro answer). The window is civil dates in the place's own zone, the
  // rule the server applies.
  const placeZone = scene.location.timeZone;
  const inWindow = windowEnd
    ? result.windows.filter((w) => civilDateString(utcToWallClock(w.start, placeZone)) <= windowEnd)
    : result.windows;
  const beyond = result.windows.length - inWindow.length;
  const shown = inWindow.slice(0, 3);
  const more = inWindow.length - shown.length;
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
        ? beyond > 0
          ? 'none inside your plan’s date window'
          : describeMilkyWayWindows(result, tz)
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
      {beyond > 0 ? (
        <span data-testid="milky-way-windows-beyond">
          {' '}
          · {beyond} more beyond your window · Pro
        </span>
      ) : null}
    </p>
  );
}

/**
 * The Moon section: phase, position, rise/set, the phase calendar, the Milky Way core and — while
 * open — the dark windows ahead. Its open state lives here so it unmounts with the element when
 * the lunar state goes away (the `moon_planning` entitlement) and comes back.
 */
function MoonDetails({
  scene,
  lunar,
  windowEnd,
}: {
  scene: SceneState;
  lunar: LunarState;
  windowEnd: string | null;
}) {
  const tz = scene.timeZone;
  const [moonOpen, setMoonOpen] = useState(false);
  // The next four principal phases from the selected day (night planning): per settled civil
  // day (a few milliseconds each; the year slider is continuous).
  const phaseFrom = useSettled(scene.dayEvents.dayStart.getTime(), 300);
  const nextPhases = useMemo(() => describeNextPhases(new Date(phaseFrom), tz), [phaseFrom, tz]);
  return (
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
          value={`${lunar.phaseName} · ${Math.round(lunar.illuminatedFraction * 100)} %`}
        />
        <Row
          label="Elevation"
          value={`${lunar.elevationDegrees.toFixed(1)}°${
            scene.terrainHorizon?.moonAboveTerrain === false && lunar.isAboveHorizon
              ? ' · behind terrain'
              : ''
          }`}
        />
        <Row
          label="Azimuth"
          value={`${lunar.azimuthDegrees.toFixed(0)}° ${compassLabel(lunar.azimuthDegrees)}`}
        />
        <Row
          label="Moonrise / set"
          value={`${lunar.moonrise ? formatWallTime(lunar.moonrise, tz) : '—'} / ${lunar.moonset ? formatWallTime(lunar.moonset, tz) : '—'}`}
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
      {scene.nightSky && moonOpen ? <DarkWindows scene={scene} windowEnd={windowEnd} /> : null}
      <p className="mt-1 text-xs text-[var(--lm-text-muted)]">{lunar.accuracyNote}</p>
    </details>
  );
}

export interface AstronomyDetailsProps {
  scene: SceneState;
  /** Last civil date (place zone) a Free plan may plan for; null when the plan is unrestricted. */
  windowEnd?: string | null;
}

export function AstronomyDetails({ scene, windowEnd = null }: AstronomyDetailsProps) {
  const s = scene.solar;
  const tz = scene.timeZone;
  const seasons = useSeasonalEnvelope(scene);
  // Sampled over the day (a few ms): once per place, day and zone, never per scrub tick.
  const lat = scene.location.point.latitude;
  const lng = scene.location.point.longitude;
  const dayEvents = scene.dayEvents;
  const lightWindows = useMemo(
    () => describeLightWindows(dayEvents, { latitude: lat, longitude: lng }, tz),
    [dayEvents, lat, lng, tz],
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
      {lightWindows ? (
        <p className="text-xs text-[var(--lm-text-muted)]" data-testid="light-windows">
          {lightWindows}
        </p>
      ) : null}
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
      {scene.lunar ? <MoonDetails scene={scene} lunar={scene.lunar} windowEnd={windowEnd} /> : null}
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

'use client';
import type { SceneState } from '@lightmap/scene';
import {
  describeExposure,
  describeSeasonalEnvelope,
  estimateExposure,
  circleOfConfusionMm,
  explainScene,
  focalLengthForFov,
  formatDeg,
  formatShutterS,
  frameCoordinates,
  skyDriftShutterS,
} from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import {
  civilDateString,
  describeMilkyWayWindows,
  formatMilkyWayWindow,
  formatWallTime,
  fullMoonsAhead,
  milkyWayWindows,
  moonApparentDiameterDeg,
  moonSizeVsMean,
  sunApparentDiameterDeg,
  utcToLocalSelection,
  utcToWallClock,
  type FullMoonSize,
  type LunarState,
} from '@lightmap/astronomy';
import { useMemo, useState } from 'react';
import { usePlannerStore } from '@/features/planner/store';
import { useSettled } from '@/lib/use-settled';
import {
  DARK_WINDOW_NIGHTS,
  describeDisc,
  describeMilkyWay,
  describeMoonSize,
  describeNextPhases,
  formatFullMoon,
} from '@/features/planner/night-text';
import { useSeasonalEnvelope } from '@/features/planner/use-seasonal';
import { describeLightWindows } from '@/features/planner/light-windows';
import { DayEventMarkers } from './Timeline';
import { buildDarkWindowsCalendar } from '@/features/export/dark-windows-calendar';
import { downloadBlob, fileStem } from '@/features/export/download';

/**
 * The nights ahead on which the core can be shot, each a click away (the planner jumps to the
 * core's highest instant inside the window). Rendered only while the Moon details are open: the
 * 45-night scan is a few tens of milliseconds and is memoised per place and civil day.
 */
function DarkWindows({
  scene,
  windowEnd,
  exportAllowed,
}: {
  scene: SceneState;
  windowEnd: string | null;
  exportAllowed: boolean;
}) {
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
      {exportAllowed && inWindow.length > 0 ? (
        <>
          {' · '}
          <button
            type="button"
            className="underline decoration-dotted underline-offset-2 hover:text-[var(--lm-text)]"
            title="Download every dark window as calendar events (.ics)"
            data-testid="milky-way-windows-calendar"
            onClick={() => {
              const ics = buildDarkWindowsCalendar(
                inWindow,
                {
                  label: scene.location.label,
                  latitude: lat,
                  longitude: lng,
                  timeZone: placeZone,
                },
                { generatedAt: new Date() },
              );
              downloadBlob(
                new Blob([ics], { type: 'text/calendar;charset=utf-8' }),
                `${fileStem(scene.location.label, 'place')}-milky-way.ics`,
              );
            }}
          >
            add to calendar
          </button>
        </>
      ) : null}
    </p>
  );
}

/**
 * The widest and the narrowest of the twelve full Moons ahead — which one to book the long-lens
 * trip for — each a click away. Rendered only while the Moon details are open: the year's phase
 * scan is some tens of milliseconds, memoised per civil day. Dates beyond a Free plan's window
 * are named (they are almanac facts) but not jumped to.
 */
function FullMoons({ scene, windowEnd }: { scene: SceneState; windowEnd: string | null }) {
  const setDate = usePlannerStore((s) => s.setDate);
  const setMinutes = usePlannerStore((s) => s.setMinutes);
  const tz = scene.timeZone;
  const placeZone = scene.location.timeZone;
  const from = useSettled(scene.dayEvents.dayStart.getTime(), 300);
  const ahead = useMemo(() => fullMoonsAhead(new Date(from), 12), [from]);
  if (ahead.closest < 0 || ahead.farthest < 0) return null;
  const jump = (at: Date) => {
    const sel = utcToLocalSelection(at, tz);
    setDate(sel.date);
    setMinutes(sel.minutes);
  };
  const entry = (m: FullMoonSize, testId: string) => {
    const inWindow = !windowEnd || civilDateString(utcToWallClock(m.at, placeZone)) <= windowEnd;
    const text = formatFullMoon(m, tz);
    return inWindow ? (
      <button
        type="button"
        className="underline decoration-dotted underline-offset-2 hover:text-[var(--lm-text)]"
        title={`Jump the planner to this full Moon (${Math.round(m.distanceKm).toLocaleString('en-US')} km away)`}
        data-testid={testId}
        onClick={() => jump(m.at)}
      >
        {text}
      </button>
    ) : (
      <span title="Beyond your plan’s date window · Pro" data-testid={testId}>
        {text}
      </span>
    );
  };
  return (
    <p className="mt-1 text-xs text-[var(--lm-text-muted)]" data-testid="full-moons">
      Full Moons in the year ahead: widest {entry(ahead.moons[ahead.closest]!, 'full-moon-widest')}{' '}
      · narrowest {entry(ahead.moons[ahead.farthest]!, 'full-moon-narrowest')}
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
  exportAllowed,
}: {
  scene: SceneState;
  lunar: LunarState;
  windowEnd: string | null;
  exportAllowed: boolean;
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
        {scene.terrainHorizon?.moonEvents?.differsFromAstronomical ? (
          <Row
            label="Moon over terrain"
            value={
              scene.terrainHorizon.moonEvents.visible.length === 0
                ? 'never today'
                : scene.terrainHorizon.moonEvents.visible
                    .map(
                      (v) =>
                        `${formatWallTime(v.from, tz)}–${v.to.getTime() >= scene.dayEvents.dayEnd.getTime() ? '24:00' : formatWallTime(v.to, tz)}`,
                    )
                    .join(' · ')
            }
            testId="terrain-moon-spells"
          />
        ) : null}
        <Row
          label="Moon disc"
          value={describeDisc(
            // The observer offset only while the Moon is up; below the horizon the almanac's figure.
            moonApparentDiameterDeg(lunar.distanceKm, Math.max(0, lunar.elevationDegrees)),
            scene.camera.mode === 'viewpoint' ? scene.camera.fovDeg : null,
          )}
          testId="moon-disc"
        />
        <Row
          label="Distance"
          value={`${Math.round(lunar.distanceKm).toLocaleString('en-US')} km · ${describeMoonSize(moonSizeVsMean(lunar.distanceKm))}`}
          testId="moon-distance"
        />
      </dl>
      <p className="mt-1 text-xs text-[var(--lm-text-muted)]" data-testid="moon-next-phases">
        Next: {nextPhases}
      </p>
      {moonOpen ? <FullMoons scene={scene} windowEnd={windowEnd} /> : null}
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
      {scene.nightSky && moonOpen ? (
        <DarkWindows scene={scene} windowEnd={windowEnd} exportAllowed={exportAllowed} />
      ) : null}
      <p className="mt-1 text-xs text-[var(--lm-text-muted)]">{lunar.accuracyNote}</p>
    </details>
  );
}

export interface AstronomyDetailsProps {
  scene: SceneState;
  /** Last civil date (place zone) a Free plan may plan for; null when the plan is unrestricted. */
  windowEnd?: string | null;
  /** The `export_preview` entitlement: the dark windows' calendar file. */
  exportAllowed?: boolean;
}

export function AstronomyDetails({
  scene,
  windowEnd = null,
  exportAllowed = false,
}: AstronomyDetailsProps) {
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
  // The Sun inside the frame at a viewpoint: flare and a blown highlight unless exposed for it.
  // At night the starting setting runs to minutes; the lens decides how long the stars stay
  // points (full-frame equivalent of the current frame; the camera box has the exact sensor).
  const exposure = estimateExposure({
    sunElevationDeg: s.elevationDegrees,
    sunTransmittance: scene.atmosphere.parameters.sunTransmittance,
    moon: scene.lunar
      ? {
          elevationDeg: scene.lunar.elevationDegrees,
          illuminatedFraction: scene.lunar.illuminatedFraction,
        }
      : null,
  });
  const starsTrail =
    scene.camera.mode === 'viewpoint' && (exposure.basis === 'stars' || exposure.basis === 'moon')
      ? skyDriftShutterS(focalLengthForFov(scene.camera.fovDeg), circleOfConfusionMm(36, 24))
      : null;
  const sunInFrame = (() => {
    if (scene.camera.mode !== 'viewpoint' || !s.isAboveHorizon) return false;
    const f = frameCoordinates(scene.camera, s.azimuthDegrees, s.apparentElevationDegrees);
    return f !== null && Math.abs(f.x) <= 1 && Math.abs(f.y) <= 1;
  })();
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
          label="Exposure (est.)"
          value={`${describeExposure(exposure)}${
            sunInFrame ? ' · sun in or near the frame: flare, expose for it' : ''
          }${starsTrail !== null ? ` · stars trail past ${formatShutterS(starsTrail)} at this lens` : ''}`}
          testId="exposure"
        />
        <Row
          label="Sun disc"
          value={describeDisc(
            sunApparentDiameterDeg(s.distanceAu),
            scene.camera.mode === 'viewpoint' ? scene.camera.fovDeg : null,
          )}
          testId="sun-disc"
        />
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
      {scene.lunar ? (
        <MoonDetails
          scene={scene}
          lunar={scene.lunar}
          windowEnd={windowEnd}
          exportAllowed={exportAllowed}
        />
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

'use client';
/**
 * Light finder — reverse planning (plan §26). "I want the sun *there*: when does that happen?"
 *
 * The target direction comes from the current sun/moon position, from the centre of the
 * viewpoint camera's frame (heading = azimuth, pitch = elevation), or from typed values. The
 * solver runs client-side in `@lightmap/astronomy` (a year of Sun alignments is a few ms), so no
 * request leaves the browser. Free plans search inside their date window; Pro searches years.
 */
import { useId, useMemo, useState } from 'react';
import {
  addCivilDays,
  civilDateString,
  formatWallTime,
  parseCivilDate,
  utcToLocalSelection,
  utcToWallClock,
  type CelestialBody,
} from '@lightmap/astronomy';
import { aboveTerrain, type SceneState } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { Button, RadioGroup } from '@lightmap/ui';
import { usePlannerStore } from '@/features/planner/store';
import { useSolver } from '@/features/finder/use-solver';
import type { SerializedMatch, SolverResultDto } from '@/features/finder/solver-types';
import { Paywall } from './Paywall';

type TargetMode = 'pick' | 'frame' | 'current' | 'manual';

export interface LightFinderProps {
  scene: SceneState;
  /** `reverse_planning` decision: unrestricted range when allowed. */
  allowed: boolean;
  reason?: string | null;
  /** Free-plan window (days) used to clip the range when not allowed. */
  windowDays: { ahead: number | null; back: number | null };
  moonAllowed: boolean;
  /** Entitlements still loading: searching is deferred so a Pro user is never clipped by mistake. */
  planLoading?: boolean;
  /** False when the 3D view is unavailable (overlay mode): nothing can be picked in it. */
  canPickInView?: boolean;
}

const MAX_RESULTS = 80;

function todayAt(timeZone: string): string {
  return civilDateString(utcToWallClock(new Date(), timeZone));
}

export function LightFinder({
  scene,
  allowed,
  reason,
  windowDays,
  moonAllowed,
  planLoading = false,
  canPickInView = true,
}: LightFinderProps) {
  const setDate = usePlannerStore((s) => s.setDate);
  const setMinutes = usePlannerStore((s) => s.setMinutes);
  const camera = usePlannerStore((s) => s.camera);
  const finderTarget = usePlannerStore((s) => s.finderTarget);
  const finderPicking = usePlannerStore((s) => s.finderPicking);
  const setFinderPicking = usePlannerStore((s) => s.setFinderPicking);
  const setFinderTarget = usePlannerStore((s) => s.setFinderTarget);
  const tz = scene.location.timeZone;
  const today = todayAt(tz);
  const ids = useId();

  const [body, setBody] = useState<CelestialBody>('sun');
  const [mode, setMode] = useState<TargetMode>('frame');
  const [manualAz, setManualAz] = useState<string>(() => scene.solar.azimuthDegrees.toFixed(0));
  const [manualEl, setManualEl] = useState<string>(() => scene.solar.elevationDegrees.toFixed(0));
  const [useElevation, setUseElevation] = useState(true);
  const [azTol, setAzTol] = useState(2);
  const [elTol, setElTol] = useState(1);
  const [minIllum, setMinIllum] = useState(80);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => {
    const t = parseCivilDate(today)!;
    return civilDateString(addCivilDays(t, 365));
  });
  const solver = useSolver();
  const [result, setResult] = useState<{
    res: SolverResultDto;
    clipped: boolean;
    ms: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bodyState = body === 'moon' ? scene.lunar : scene.solar;
  const target = useMemo(() => {
    if (mode === 'pick' && finderTarget)
      return { az: finderTarget.azimuthDeg, el: finderTarget.elevationDeg };
    if (mode === 'pick' || mode === 'frame') return { az: camera.headingDeg, el: camera.pitchDeg };
    if (mode === 'current' && bodyState)
      return { az: bodyState.azimuthDegrees, el: bodyState.elevationDegrees };
    const az = Number(manualAz);
    const el = Number(manualEl);
    return { az: Number.isFinite(az) ? az : 0, el: Number.isFinite(el) ? el : 0 };
  }, [mode, finderTarget, camera.headingDeg, camera.pitchDeg, bodyState, manualAz, manualEl]);

  function run() {
    void search();
  }

  async function search() {
    setError(null);
    const f = parseCivilDate(from);
    const t = parseCivilDate(to);
    if (!f || !t) {
      setError('Enter valid dates (YYYY-MM-DD).');
      return;
    }
    // Free plans: clip to the window instead of refusing (plan §38 — explain, never block silently).
    let clipped = false;
    let fromC = f;
    let toC = t;
    if (!allowed) {
      const td = parseCivilDate(today)!;
      const minDate = windowDays.back === null ? f : addCivilDays(td, -windowDays.back);
      const maxDate = windowDays.ahead === null ? t : addCivilDays(td, windowDays.ahead);
      if (civilDateString(f) < civilDateString(minDate)) {
        fromC = minDate;
        clipped = true;
      }
      if (civilDateString(t) > civilDateString(maxDate)) {
        toC = maxDate;
        clipped = true;
      }
    }
    if (civilDateString(fromC) > civilDateString(toC)) {
      setError('The range is empty after applying your plan window.');
      setResult(null);
      return;
    }
    try {
      const { result: res, ms } = await solver.run({
        latitude: scene.location.point.latitude,
        longitude: scene.location.point.longitude,
        timeZone: tz,
        from: fromC,
        to: toC,
        body,
        target: {
          azimuthDegrees: target.az,
          azimuthToleranceDegrees: azTol,
          ...(useElevation
            ? { elevationDegrees: target.el, elevationToleranceDegrees: elTol }
            : {}),
        },
        ...(body === 'moon' ? { minIlluminatedFraction: minIllum / 100 } : {}),
        maxDays: 1100,
      });
      setResult({ res, clipped, ms });
    } catch (e) {
      if (e instanceof Error && e.message === 'superseded') return; // a newer search replaced it
      setError(e instanceof Error ? e.message : 'Search failed.');
    }
  }

  function jumpTo(m: SerializedMatch) {
    // Elapsed minutes since local midnight, so the jump lands on the instant even on a DST day.
    const sel = utcToLocalSelection(new Date(m.timestampUtc), tz);
    setDate(sel.date);
    setMinutes(sel.minutes);
  }

  const profile = scene.terrainHorizon?.profile ?? null;
  const [hideBehindTerrain, setHideBehindTerrain] = useState(false);
  const behindTerrain = (m: SerializedMatch) =>
    profile !== null && !aboveTerrain(profile, m.azimuthDegrees, m.elevationDegrees);
  const allMatches = result?.res.matches ?? [];
  const hidden = profile && hideBehindTerrain ? allMatches.filter(behindTerrain).length : 0;
  const matches =
    profile && hideBehindTerrain ? allMatches.filter((m) => !behindTerrain(m)) : allMatches;
  const shown = matches.slice(0, MAX_RESULTS);
  const dates = new Set(matches.map((m) => m.date)).size;

  return (
    <div className="space-y-3" data-testid="light-finder">
      <p className="text-sm text-[var(--lm-text-muted)]">
        Find every moment when the {body === 'sun' ? 'sun' : 'moon'} sits at a chosen direction from
        this viewpoint — for example setting behind a ridge, or rising over the bay.
      </p>

      {/* Body */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">Body</span>
        <RadioGroup<CelestialBody>
          ariaLabel="Celestial body"
          value={body}
          onChange={setBody}
          options={[
            { value: 'sun', label: 'Sun', testId: 'finder-body-sun' },
            {
              value: 'moon',
              label: 'Moon',
              testId: 'finder-body-moon',
              ...(moonAllowed
                ? {}
                : { locked: true, lockedReason: 'Moon planning is part of Pro.' }),
            },
          ]}
        />
      </div>

      {/* Target */}
      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Where should it be?
        </legend>
        <RadioGroup<TargetMode>
          ariaLabel="Target direction source"
          variant="grid"
          columns={2}
          value={mode}
          onChange={(m) => {
            setMode(m);
            if (m === 'pick') {
              if (!finderTarget) setFinderPicking(true);
            } else {
              // The ring belongs to pick mode; leaving it must not leave a stale target behind.
              if (finderPicking) setFinderPicking(false);
              if (finderTarget) setFinderTarget(null);
            }
          }}
          className="text-xs"
          options={[
            {
              value: 'pick',
              label: 'Point in the view',
              testId: 'finder-mode-pick',
              ...(canPickInView
                ? {}
                : {
                    locked: true,
                    lockedReason: 'Needs the 3D view; this device shows the light overlay only.',
                  }),
            },
            { value: 'frame', label: 'Centre of frame', testId: 'finder-mode-frame' },
            { value: 'current', label: 'Where it is now', testId: 'finder-mode-current' },
            { value: 'manual', label: 'Type a bearing', testId: 'finder-mode-manual' },
          ]}
        />
        {mode === 'pick' ? (
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--lm-text-muted)]">
            <span>
              {finderPicking
                ? 'Click the spot in the 3D view where the sun or moon should be.'
                : finderTarget
                  ? `Picked ${Math.round(finderTarget.azimuthDeg)}° ${compassLabel(finderTarget.azimuthDeg)}, ${finderTarget.elevationDeg.toFixed(1)}° up — drag the ring in the view to adjust.`
                  : 'Nothing picked yet.'}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setFinderPicking(!finderPicking)}
              aria-pressed={finderPicking}
              data-testid="finder-pick"
            >
              {finderPicking ? 'Cancel' : finderTarget ? 'Pick again' : 'Pick'}
            </Button>
          </div>
        ) : null}
        {mode === 'frame' ? (
          <p className="text-xs text-[var(--lm-text-muted)]">
            Uses the camera heading and pitch ({Math.round(camera.headingDeg)}°{' '}
            {compassLabel(camera.headingDeg)}, {camera.pitchDeg.toFixed(0)}° up). Aim the viewpoint
            camera at the spot first.
          </p>
        ) : null}
        {mode === 'current' && !bodyState ? (
          <p className="text-xs text-[var(--lm-text-muted)]">Moon data is not available here.</p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-[var(--lm-text-muted)]">
            Azimuth °
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={360}
              step={0.5}
              className="lm-input mt-1 w-full"
              value={mode === 'manual' ? manualAz : target.az.toFixed(1)}
              readOnly={mode !== 'manual'}
              onChange={(e) => setManualAz(e.target.value)}
              data-testid="finder-azimuth"
            />
          </label>
          <div className="text-xs text-[var(--lm-text-muted)]">
            <span className="flex items-center justify-between">
              <label htmlFor={`${ids}-el`}>Elevation °</label>
              <label className="flex items-center gap-1 normal-case">
                <input
                  type="checkbox"
                  checked={useElevation}
                  onChange={(e) => setUseElevation(e.target.checked)}
                />
                match
              </label>
            </span>
            <input
              id={`${ids}-el`}
              type="number"
              inputMode="decimal"
              min={-90}
              max={90}
              step={0.5}
              className="lm-input mt-1 w-full disabled:opacity-50"
              value={mode === 'manual' ? manualEl : target.el.toFixed(1)}
              readOnly={mode !== 'manual'}
              disabled={!useElevation}
              onChange={(e) => setManualEl(e.target.value)}
              data-testid="finder-elevation"
            />
          </div>
        </div>
      </fieldset>

      {/* Range */}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-[var(--lm-text-muted)]">
          From
          <input
            type="date"
            className="lm-input mt-1 w-full"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            data-testid="finder-from"
          />
        </label>
        <label className="text-xs text-[var(--lm-text-muted)]">
          To
          <input
            type="date"
            className="lm-input mt-1 w-full"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            data-testid="finder-to"
          />
        </label>
      </div>

      <details>
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Tolerances
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs text-[var(--lm-text-muted)]">
            Azimuth ± {azTol}°
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={azTol}
              className="lm-range mt-1 w-full"
              disabled={!useElevation}
              onChange={(e) => setAzTol(Number(e.target.value))}
            />
            {!useElevation ? (
              <span className="block normal-case">
                Applies when elevation is matched: “anywhere within ± this bearing at that height”.
              </span>
            ) : null}
          </label>
          <label className="text-xs text-[var(--lm-text-muted)]">
            Elevation ± {elTol}°
            <input
              type="range"
              min={0.25}
              max={5}
              step={0.25}
              value={elTol}
              className="lm-range mt-1 w-full"
              disabled={!useElevation}
              onChange={(e) => setElTol(Number(e.target.value))}
            />
          </label>
          {body === 'moon' ? (
            <label className="col-span-2 text-xs text-[var(--lm-text-muted)]">
              Moon at least {minIllum} % lit
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minIllum}
                className="lm-range mt-1 w-full"
                onChange={(e) => setMinIllum(Number(e.target.value))}
              />
            </label>
          ) : null}
        </div>
      </details>

      <Button
        variant="primary"
        className="w-full"
        onClick={run}
        disabled={planLoading || solver.busy || (mode === 'pick' && !finderTarget)}
        data-testid="finder-run"
      >
        {planLoading
          ? 'Checking your plan…'
          : solver.busy
            ? 'Searching…'
            : mode === 'pick' && !finderTarget
              ? 'Pick a point first'
              : 'Find dates'}
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-[color:#ffb3b3]">
          {error}
        </p>
      ) : null}

      <div role="status" className={result ? 'space-y-2' : 'sr-only'} data-testid="finder-results">
        {result ? (
          <p className="text-sm">
            <strong>{matches.length}</strong> {matches.length === 1 ? 'moment' : 'moments'} on{' '}
            <strong>{dates}</strong> {dates === 1 ? 'date' : 'dates'}
            <span className="text-[var(--lm-text-faint)]">
              {' '}
              · scanned {result.res.scannedDays} days in {result.ms.toFixed(0)} ms
              {result.res.truncated ? ' · range capped at 1100 days' : ''}
              {hidden > 0 ? ` · ${hidden} behind terrain hidden` : ''}
            </span>
          </p>
        ) : null}
      </div>
      {profile ? (
        <label className="flex items-center gap-2 text-xs text-[var(--lm-text-muted)]">
          <input
            type="checkbox"
            checked={hideBehindTerrain}
            onChange={(e) => setHideBehindTerrain(e.target.checked)}
            data-testid="finder-hide-terrain"
          />
          Hide moments when the {body} is behind the terrain
          <span className="sr-only">. {profile.caveat}</span>
        </label>
      ) : null}
      {result ? (
        <div className="space-y-2" data-testid="finder-results-list">
          {result.clipped ? (
            <Paywall
              compact
              reason={
                reason ??
                'Your plan searches inside its date window; the range was clipped. Pro searches years ahead.'
              }
            />
          ) : null}
          {matches.length === 0 ? (
            <p className="text-sm text-[var(--lm-text-muted)]">
              Nothing in this range. Widen the tolerances, drop the elevation match, or extend the
              dates — the {body} may never reach that direction from this latitude.
            </p>
          ) : (
            <ol className="max-h-64 space-y-1 overflow-y-auto pr-1 text-sm">
              {shown.map((m) => (
                <li key={m.timestampUtc}>
                  <button
                    type="button"
                    onClick={() => jumpTo(m)}
                    className="flex w-full items-center justify-between gap-2 rounded-[var(--lm-radius)] px-2 py-1.5 text-left ring-1 ring-inset ring-white/10 hover:bg-white/8"
                  >
                    <span className="sr-only">Jump to </span>
                    <span className="font-mono tabular-nums">
                      {m.date} {formatWallTime(new Date(m.timestampUtc), tz)}
                    </span>
                    <span className="text-xs text-[var(--lm-text-muted)]">
                      {m.elevationDegrees.toFixed(1)}° {m.trend}
                      {m.illuminatedFraction !== null
                        ? ` · ${Math.round(m.illuminatedFraction * 100)} % lit`
                        : ''}
                      {behindTerrain(m) ? (
                        <span className="ml-1 text-[color:#ffd27a]" title={profile?.caveat}>
                          · behind terrain
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
              {matches.length > MAX_RESULTS ? (
                <li className="px-2 text-xs text-[var(--lm-text-muted)]">
                  Showing the first {MAX_RESULTS}; narrow the range or tolerances to see the rest.
                </li>
              ) : null}
            </ol>
          )}
          <p className="text-xs text-[var(--lm-text-muted)]">
            Times are local ({tz}). Geometry only: terrain occlusion, clouds and refraction near the
            horizon are not part of this search — use the preview to check the actual scene.
          </p>
        </div>
      ) : null}
    </div>
  );
}

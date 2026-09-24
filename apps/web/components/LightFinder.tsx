'use client';
/**
 * Light finder — reverse planning (plan §26). "I want the sun *there*: when does that happen?"
 *
 * The target direction comes from the current sun/moon position, from the centre of the
 * viewpoint camera's frame (heading = azimuth, pitch = elevation), or from typed values. The
 * solver runs client-side in `@lightmap/astronomy` (a year of Sun alignments is a few ms), so no
 * request leaves the browser. Free plans search inside their date window; Pro searches years.
 */
import { useMemo, useState } from 'react';
import {
  addCivilDays,
  civilDateString,
  findDirectionMatches,
  formatWallTime,
  parseCivilDate,
  utcToWallClock,
  type CelestialBody,
  type DirectionMatch,
  type SolverResult,
} from '@lightmap/astronomy';
import type { SceneState } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { Button, cx } from '@lightmap/ui';
import { usePlannerStore } from '@/features/planner/store';
import { Paywall } from './Paywall';

type TargetMode = 'current' | 'frame' | 'manual';

export interface LightFinderProps {
  scene: SceneState;
  /** `reverse_planning` decision: unrestricted range when allowed. */
  allowed: boolean;
  reason?: string | null;
  /** Free-plan window (days) used to clip the range when not allowed. */
  windowDays: { ahead: number | null; back: number | null };
  moonAllowed: boolean;
}

const MAX_RESULTS = 80;

function todayAt(timeZone: string): string {
  return civilDateString(utcToWallClock(new Date(), timeZone));
}

export function LightFinder({ scene, allowed, reason, windowDays, moonAllowed }: LightFinderProps) {
  const setDate = usePlannerStore((s) => s.setDate);
  const setMinutes = usePlannerStore((s) => s.setMinutes);
  const camera = usePlannerStore((s) => s.camera);
  const tz = scene.location.timeZone;
  const today = todayAt(tz);

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
  const [result, setResult] = useState<{ res: SolverResult; clipped: boolean; ms: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const bodyState = body === 'moon' ? scene.lunar : scene.solar;
  const target = useMemo(() => {
    if (mode === 'frame') return { az: camera.headingDeg, el: camera.pitchDeg };
    if (mode === 'current' && bodyState)
      return { az: bodyState.azimuthDegrees, el: bodyState.elevationDegrees };
    const az = Number(manualAz);
    const el = Number(manualEl);
    return { az: Number.isFinite(az) ? az : 0, el: Number.isFinite(el) ? el : 0 };
  }, [mode, camera.headingDeg, camera.pitchDeg, bodyState, manualAz, manualEl]);

  function run() {
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
      const t0 = performance.now();
      const res = findDirectionMatches({
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
      setResult({ res, clipped, ms: performance.now() - t0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    }
  }

  function jumpTo(m: DirectionMatch) {
    const w = utcToWallClock(m.timestampUtc, tz);
    setDate(civilDateString(w));
    setMinutes(w.hour * 60 + w.minute);
  }

  const matches = result?.res.matches ?? [];
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
        <div
          role="radiogroup"
          aria-label="Celestial body"
          className="flex rounded-full bg-white/8 p-0.5 ring-1 ring-inset ring-white/10"
        >
          {(['sun', 'moon'] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={body === b}
              disabled={b === 'moon' && !moonAllowed}
              onClick={() => setBody(b)}
              className={cx(
                'h-9 rounded-full px-3 text-sm capitalize disabled:opacity-40',
                body === b
                  ? 'bg-[var(--lm-text)] text-[var(--lm-chrome)]'
                  : 'text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]',
              )}
              data-testid={`finder-body-${b}`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Target */}
      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Where should it be?
        </legend>
        <div className="grid grid-cols-3 gap-1 text-sm">
          {(
            [
              ['frame', 'Centre of frame'],
              ['current', `Where it is now`],
              ['manual', 'Type a bearing'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cx(
                'h-9 rounded-[var(--lm-radius)] px-2 text-xs ring-1 ring-inset ring-white/10',
                mode === m
                  ? 'bg-white/12'
                  : 'text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]',
              )}
              data-testid={`finder-mode-${m}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'frame' ? (
          <p className="text-xs text-[var(--lm-text-faint)]">
            Uses the camera heading and pitch ({Math.round(camera.headingDeg)}°{' '}
            {compassLabel(camera.headingDeg)}, {camera.pitchDeg.toFixed(0)}° up). Aim the viewpoint
            camera at the spot first.
          </p>
        ) : null}
        {mode === 'current' && !bodyState ? (
          <p className="text-xs text-[var(--lm-text-faint)]">Moon data is not available here.</p>
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
          <label className="text-xs text-[var(--lm-text-muted)]">
            <span className="flex items-center justify-between">
              Elevation °
              <span className="flex items-center gap-1 normal-case">
                <input
                  type="checkbox"
                  checked={useElevation}
                  onChange={(e) => setUseElevation(e.target.checked)}
                  aria-label="Match elevation too"
                />
                match
              </span>
            </span>
            <input
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
          </label>
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
              onChange={(e) => setAzTol(Number(e.target.value))}
            />
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

      <Button variant="primary" className="w-full" onClick={run} data-testid="finder-run">
        Find dates
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-[color:#ffb3b3]">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-2" data-testid="finder-results">
          <p className="text-sm">
            <strong>{matches.length}</strong> {matches.length === 1 ? 'moment' : 'moments'} on{' '}
            <strong>{dates}</strong> {dates === 1 ? 'date' : 'dates'}
            <span className="text-[var(--lm-text-faint)]">
              {' '}
              · scanned {result.res.scannedDays} days in {result.ms.toFixed(0)} ms
              {result.res.truncated ? ' · range capped at 1100 days' : ''}
            </span>
          </p>
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
                <li key={m.timestampUtc.toISOString()}>
                  <button
                    type="button"
                    onClick={() => jumpTo(m)}
                    className="flex w-full items-center justify-between gap-2 rounded-[var(--lm-radius)] px-2 py-1.5 text-left ring-1 ring-inset ring-white/10 hover:bg-white/8"
                    aria-label={`Jump to ${m.date} ${formatWallTime(m.timestampUtc, tz)}`}
                  >
                    <span className="font-mono tabular-nums">
                      {m.date} {formatWallTime(m.timestampUtc, tz)}
                    </span>
                    <span className="text-xs text-[var(--lm-text-muted)]">
                      {m.elevationDegrees.toFixed(1)}° {m.trend}
                      {m.illuminatedFraction !== null
                        ? ` · ${Math.round(m.illuminatedFraction * 100)} % lit`
                        : ''}
                    </span>
                  </button>
                </li>
              ))}
              {matches.length > MAX_RESULTS ? (
                <li className="px-2 text-xs text-[var(--lm-text-faint)]">
                  Showing the first {MAX_RESULTS}; narrow the range or tolerances to see the rest.
                </li>
              ) : null}
            </ol>
          )}
          <p className="text-xs text-[var(--lm-text-faint)]">
            Times are local ({tz}). Geometry only: terrain occlusion, clouds and refraction near the
            horizon are not part of this search — use the preview to check the actual scene.
          </p>
        </div>
      ) : null}
    </div>
  );
}

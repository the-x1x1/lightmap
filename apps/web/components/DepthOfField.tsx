'use client';
/**
 * Depth of field (Phase 6): what this lens, sensor, aperture and focus distance hold sharp.
 * Numbers only — the preview is never blurred, so geometry stays readable.
 */
import { useState } from 'react';
import {
  APERTURE_STOPS,
  SENSOR_PRESETS,
  circleOfConfusionMm,
  depthOfField,
  feetFromMetres,
  focalLengthForFov,
  formatDistance,
  metresFromFeet,
} from '@lightmap/scene';
import { usePlannerStore } from '@/features/planner/store';
import { Button } from '@lightmap/ui';

export function DepthOfField() {
  const camera = usePlannerStore((s) => s.camera);
  const sensorWidthMm = usePlannerStore((s) => s.sensorWidthMm);
  const aperture = usePlannerStore((s) => s.aperture);
  const focusDistanceM = usePlannerStore((s) => s.focusDistanceM);
  const setAperture = usePlannerStore((s) => s.setAperture);
  const setFocusDistance = usePlannerStore((s) => s.setFocusDistance);
  const units = usePlannerStore((s) => s.units);
  const imperial = units === 'imperial';
  const fmt = (m: number) => formatDistance(m, units);
  // While the box has focus it shows exactly what was typed (so "0." on the way to "0.5", or an
  // empty box, is not snapped back); on blur it settles on the stored distance.
  const [focusText, setFocusText] = useState<string | null>(null);

  const sensor = SENSOR_PRESETS.find((x) => Math.abs(x.widthMm - sensorWidthMm) < 0.05);
  const coc = circleOfConfusionMm(sensorWidthMm, sensor?.heightMm);
  // The real glass on this sensor that gives the current frame.
  const lensMm = focalLengthForFov(camera.fovDeg, sensorWidthMm);
  const dof = depthOfField({ focalLengthMm: lensMm, aperture, focusDistanceM, cocMm: coc });

  // The box is in the photographer's units; the store keeps metres.
  const focusShown = imperial ? feetFromMetres(focusDistanceM) : focusDistanceM;
  const derivedFocus = String(Math.round(focusShown * 10) / 10);
  const focusValue = focusText ?? derivedFocus;
  // The store's floor is 0.1 m; 0.4 ft (0.12 m) is the nearest tidy figure above it.
  const minShown = imperial ? 0.4 : 0.1;
  const stops: readonly number[] = APERTURE_STOPS;
  const apertureOptions = stops.includes(aperture)
    ? stops
    : [...stops, aperture].sort((a, b) => a - b);

  return (
    <section className="mt-3 space-y-2" aria-labelledby="lm-dof-title" data-testid="dof">
      <h3 id="lm-dof-title" className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
        Depth of field
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-[var(--lm-text-muted)]">
          Aperture
          <select
            className="lm-input mt-1 w-full"
            value={String(aperture)}
            onChange={(e) => setAperture(Number(e.target.value))}
            data-testid="dof-aperture"
          >
            {apertureOptions.map((n) => (
              <option key={n} value={String(n)}>
                f/{n}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--lm-text-muted)]">
          Focus distance ({imperial ? 'ft' : 'm'})
          <input
            type="number"
            inputMode="decimal"
            min={minShown}
            step={0.1}
            className="lm-input mt-1 w-full"
            value={focusValue}
            onChange={(e) => {
              setFocusText(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(n) && n >= minShown)
                setFocusDistance(imperial ? metresFromFeet(n) : n);
            }}
            onBlur={() => setFocusText(null)}
            data-testid="dof-focus"
          />
        </label>
      </div>
      <p className="text-sm" role="status" aria-live="polite" data-testid="dof-result">
        Sharp from <strong className="tabular-nums">{fmt(dof.nearM)}</strong> to{' '}
        <strong className="tabular-nums">{fmt(dof.farM)}</strong>
        {dof.infinitySharp
          ? ' — the sun, moon and horizon are in focus.'
          : ` (${fmt(dof.totalM)} deep). The horizon is soft.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setFocusText(null);
            // Rounded up to the next 0.1 (m or ft) so the rounded figure still reaches infinity.
            const shown = imperial ? feetFromMetres(dof.hyperfocalM) : dof.hyperfocalM;
            const rounded = Math.ceil(shown * 10 + 1e-9) / 10;
            // Never below the hyperfocal itself (a feet→metres round trip can land 1 ulp short).
            setFocusDistance(
              Math.max(dof.hyperfocalM, imperial ? metresFromFeet(rounded) : rounded),
            );
          }}
          data-testid="dof-hyperfocal"
        >
          Focus at hyperfocal ({fmt(dof.hyperfocalM)})
        </Button>
      </div>
      <p className="text-xs text-[var(--lm-text-muted)]">
        {lensMm.toFixed(lensMm < 10 ? 1 : 0)} mm on this sensor, circle of confusion{' '}
        {coc.toFixed(3)} mm (sensor diagonal ÷ 1500 — a print-viewing convention; pixel-peeping
        needs a smaller one). The preview itself is not blurred.
      </p>
    </section>
  );
}

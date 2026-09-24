'use client';
/** Viewpoint camera (plan §5): map/viewpoint toggle, heading dial, pitch, lens presets, sensor format. */
import { useState } from 'react';
import {
  FOCAL_LENGTH_PRESETS_MM,
  SENSOR_PRESETS,
  actualFocalLengthMm,
  equivalentFocalLengthMm,
} from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { usePlannerStore } from '@/features/planner/store';
import { Button, cx, useRovingRadio } from '@lightmap/ui';

const MODES = ['map', 'viewpoint'] as const;

export function CameraControls({ advancedAllowed }: { advancedAllowed: boolean }) {
  const camera = usePlannerStore((s) => s.camera);
  const setCameraMode = usePlannerStore((s) => s.setCameraMode);
  const setHeading = usePlannerStore((s) => s.setHeading);
  const setPitch = usePlannerStore((s) => s.setPitch);
  const setFocalLength = usePlannerStore((s) => s.setFocalLength);
  const sensorWidthMm = usePlannerStore((s) => s.sensorWidthMm);
  const setSensorWidth = usePlannerStore((s) => s.setSensorWidth);
  const setActualFocalLength = usePlannerStore((s) => s.setActualFocalLength);
  const isVp = camera.mode === 'viewpoint';
  const sensor = SENSOR_PRESETS.find((x) => Math.abs(x.widthMm - sensorWidthMm) < 0.05);
  // The lens box is "controlled while typing": it shows the typed text only while it still maps
  // to the camera's current focal length; presets, the wheel or a restored viewpoint make it
  // fall back to the derived value, so it never contradicts the frame.
  const [lensText, setLensText] = useState<string | null>(null);
  const derivedLens = camera.focalLengthMm
    ? actualFocalLengthMm(camera.focalLengthMm, sensorWidthMm).toFixed(
        actualFocalLengthMm(camera.focalLengthMm, sensorWidthMm) < 10 ? 1 : 0,
      )
    : '';
  const typedMatches =
    lensText !== null &&
    camera.focalLengthMm !== null &&
    Math.abs(equivalentFocalLengthMm(Number(lensText), sensorWidthMm) - camera.focalLengthMm) < 0.6;
  const lensValue = typedMatches ? lensText : derivedLens;
  const modeKeys = useRovingRadio(MODES.length, MODES.indexOf(camera.mode), (i) => {
    const m = MODES[i];
    if (m) setCameraMode(m);
  });
  const lensLocked = (mm: number) => !advancedAllowed && mm !== 24 && mm !== 35;
  const lensKeys = useRovingRadio(
    FOCAL_LENGTH_PRESETS_MM.length,
    FOCAL_LENGTH_PRESETS_MM.findIndex((mm) => mm === camera.focalLengthMm),
    (i) => {
      const mm = FOCAL_LENGTH_PRESETS_MM[i];
      if (mm !== undefined && !lensLocked(mm)) setFocalLength(mm);
    },
    (i) => {
      const mm = FOCAL_LENGTH_PRESETS_MM[i];
      return mm === undefined || lensLocked(mm);
    },
  );
  return (
    <div className="space-y-3" data-testid="camera-controls">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">Camera</span>
        <div
          role="radiogroup"
          aria-label="View mode"
          className="flex rounded-full bg-white/8 p-0.5 ring-1 ring-inset ring-white/10"
        >
          {MODES.map((m, i) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={camera.mode === m}
              {...modeKeys(i)}
              onClick={() => setCameraMode(m)}
              className={cx(
                'h-9 rounded-full px-3 text-sm',
                camera.mode === m
                  ? 'bg-[var(--lm-text)] text-[var(--lm-chrome)]'
                  : 'text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]',
              )}
              data-testid={`camera-mode-${m}`}
            >
              {m === 'map' ? 'Map' : 'Viewpoint'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="lm-heading" className="text-sm text-[var(--lm-text-muted)]">
            Heading
          </label>
          <output
            htmlFor="lm-heading"
            className="font-mono text-sm tabular-nums"
            data-testid="camera-heading"
          >
            {Math.round(camera.headingDeg)}° {compassLabel(camera.headingDeg)}
          </output>
        </div>
        <input
          id="lm-heading"
          type="range"
          className="lm-range"
          min={0}
          max={359}
          step={1}
          value={Math.round(camera.headingDeg)}
          onChange={(e) => setHeading(Number(e.target.value))}
          aria-valuetext={`${Math.round(camera.headingDeg)} degrees, ${compassLabel(camera.headingDeg)}`}
        />
      </div>
      {isVp ? (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="lm-pitch" className="text-sm text-[var(--lm-text-muted)]">
              Pitch
            </label>
            <output htmlFor="lm-pitch" className="font-mono text-sm tabular-nums">
              {Math.round(camera.pitchDeg)}°
            </output>
          </div>
          <input
            id="lm-pitch"
            type="range"
            className="lm-range"
            min={-60}
            max={60}
            step={1}
            value={Math.round(camera.pitchDeg)}
            onChange={(e) => setPitch(Number(e.target.value))}
            aria-valuetext={`${Math.abs(Math.round(camera.pitchDeg))} degrees ${camera.pitchDeg >= 0 ? 'up' : 'down'}`}
          />
        </div>
      ) : null}
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm text-[var(--lm-text-muted)]">Lens (full-frame equiv.)</span>
          <span className="font-mono text-sm tabular-nums">
            {camera.focalLengthMm
              ? `${camera.focalLengthMm} mm`
              : `${camera.fovDeg.toFixed(0)}° fov`}
          </span>
        </div>
        <div
          role="radiogroup"
          aria-label="Lens"
          className="lm-scrollbar-none flex gap-1.5 overflow-x-auto pb-1"
        >
          {FOCAL_LENGTH_PRESETS_MM.map((mm, i) => {
            const locked = lensLocked(mm);
            return (
              <Button
                key={mm}
                size="sm"
                variant={camera.focalLengthMm === mm ? 'primary' : 'secondary'}
                role="radio"
                aria-checked={camera.focalLengthMm === mm}
                aria-label={`${mm} mm${locked ? ', Pro' : ''}`}
                {...lensKeys(i)}
                onClick={() => {
                  if (!locked) setFocalLength(mm);
                }}
                aria-disabled={locked || undefined}
                className={locked ? 'cursor-not-allowed opacity-50' : undefined}
                title={locked ? 'More lenses with Pro' : undefined}
                data-testid={`lens-${mm}`}
              >
                {mm}
              </Button>
            );
          })}
        </div>
        {!advancedAllowed ? (
          <p className="mt-1 text-xs text-[var(--lm-text-muted)]">
            16, 50, 85 and 135 mm are part of Pro. 24 and 35 mm are free.
          </p>
        ) : null}
      </div>
      {advancedAllowed ? (
        <details data-testid="sensor-format">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
            Your camera
            {sensor && sensor.id !== 'full-frame' ? (
              <span className="ml-2 normal-case tracking-normal text-[var(--lm-text)]">
                {sensor.label.split(' (')[0]}
              </span>
            ) : null}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-[var(--lm-text-muted)]">
              Sensor
              <select
                className="lm-input mt-1 w-full"
                value={sensor?.id ?? 'custom'}
                onChange={(e) => {
                  const p = SENSOR_PRESETS.find((x) => x.id === e.target.value);
                  if (!p) return;
                  setSensorWidth(p.widthMm);
                  // Keep the lens the photographer typed: the same glass on the new sensor.
                  const mm = Number(lensValue);
                  if (Number.isFinite(mm) && mm >= 1 && mm <= 2000) {
                    usePlannerStore.getState().setActualFocalLength(mm);
                    setLensText(lensValue);
                  }
                }}
                data-testid="sensor-select"
              >
                {SENSOR_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {!sensor ? <option value="custom">Custom ({sensorWidthMm} mm wide)</option> : null}
              </select>
            </label>
            <label className="text-xs text-[var(--lm-text-muted)]">
              Your lens (mm)
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={2000}
                step={1}
                className="lm-input mt-1 w-full"
                value={lensValue}
                placeholder="mm"
                onChange={(e) => {
                  setLensText(e.target.value);
                  const mm = Number(e.target.value);
                  if (Number.isFinite(mm) && mm >= 1 && mm <= 2000) setActualFocalLength(mm);
                }}
                data-testid="lens-actual"
              />
            </label>
          </div>
          <p className="mt-1 text-xs text-[var(--lm-text-muted)]">
            Presets above are full-frame equivalents; type the number printed on your lens and the
            frame matches it on your sensor
            {camera.focalLengthMm && sensor && sensor.id !== 'full-frame'
              ? ` (${camera.focalLengthMm} mm equiv. = ${actualFocalLengthMm(camera.focalLengthMm, sensorWidthMm).toFixed(0)} mm on ${sensor.label.split(' (')[0]})`
              : ''}
            .
          </p>
        </details>
      ) : null}
    </div>
  );
}

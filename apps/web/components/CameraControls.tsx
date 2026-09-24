'use client';
/** Viewpoint camera (plan §5): map/viewpoint toggle, heading dial, pitch, lens presets. */
import { FOCAL_LENGTH_PRESETS_MM } from '@lightmap/scene';
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
  const isVp = camera.mode === 'viewpoint';
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
    </div>
  );
}

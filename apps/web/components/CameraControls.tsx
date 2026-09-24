'use client';
/** Viewpoint camera (plan §5): map/viewpoint toggle, heading dial, pitch, lens presets. */
import { FOCAL_LENGTH_PRESETS_MM } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { usePlannerStore } from '@/features/planner/store';
import { Button, cx } from '@lightmap/ui';

export function CameraControls({ advancedAllowed }: { advancedAllowed: boolean }) {
  const camera = usePlannerStore((s) => s.camera);
  const setCameraMode = usePlannerStore((s) => s.setCameraMode);
  const setHeading = usePlannerStore((s) => s.setHeading);
  const setPitch = usePlannerStore((s) => s.setPitch);
  const setFocalLength = usePlannerStore((s) => s.setFocalLength);
  const isVp = camera.mode === 'viewpoint';
  return (
    <div className="space-y-3" data-testid="camera-controls">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">Camera</span>
        <div
          role="radiogroup"
          aria-label="View mode"
          className="flex rounded-full bg-white/8 p-0.5 ring-1 ring-inset ring-white/10"
        >
          {(['map', 'viewpoint'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={camera.mode === m}
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
          {FOCAL_LENGTH_PRESETS_MM.map((mm) => {
            const locked = !advancedAllowed && mm !== 24 && mm !== 35;
            return (
              <Button
                key={mm}
                size="sm"
                variant={camera.focalLengthMm === mm ? 'primary' : 'secondary'}
                role="radio"
                aria-checked={camera.focalLengthMm === mm}
                onClick={() => setFocalLength(mm)}
                disabled={locked}
                title={locked ? 'More lenses with Pro' : undefined}
                data-testid={`lens-${mm}`}
              >
                {mm}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

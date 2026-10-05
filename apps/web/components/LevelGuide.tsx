'use client';
/**
 * Horizon levelling overlay for the viewpoint view (Phase 6): rule-of-thirds grid, the true-level
 * line, and the modelled terrain skyline (the ridge the sun timings use). Lines only — the
 * controls live in the camera panel (`LevelControls`) so nothing stacks up on the map.
 */
import { HORIZON_PLACEMENTS, levelLineY, pitchForHorizonAt, skylinePath } from '@lightmap/scene';
import { usePlannerStore } from '@/features/planner/store';
import { Button } from '@lightmap/ui';

/** Frame coordinates (−1…1, y up) → SVG percent space (0…100, y down). */
const sx = (x: number) => ((x + 1) / 2) * 100;
const sy = (y: number) => ((1 - y) / 2) * 100;

export function LevelGuide() {
  const camera = usePlannerStore((s) => s.camera);
  const profile = usePlannerStore((s) => s.horizonProfile);
  const aspect = usePlannerStore((s) => s.viewportAspect);
  const levelY = levelLineY(camera, aspect);
  const sky = profile ? skylinePath(camera, profile, aspect) : [];
  const skyPoints = sky.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ');
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      data-testid="level-guide"
    >
      {[100 / 3, 200 / 3].map((v) => (
        <g key={v} stroke="rgba(255,255,255,0.22)" strokeWidth={1}>
          <line x1={v} y1={0} x2={v} y2={100} vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={v} x2={100} y2={v} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {skyPoints ? (
        <polyline
          points={skyPoints}
          fill="none"
          stroke="var(--lm-sun)"
          strokeOpacity={0.85}
          strokeWidth={1.5}
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
          data-testid="level-skyline"
        />
      ) : null}
      {levelY !== null ? (
        <line
          x1={0}
          x2={100}
          y1={sy(levelY)}
          y2={sy(levelY)}
          stroke="white"
          strokeOpacity={0.9}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          data-testid="level-line"
        />
      ) : null}
    </svg>
  );
}

/** Where level sits, and buttons that pitch the camera to put it on a third — in the camera panel. */
export function LevelControls() {
  const camera = usePlannerStore((s) => s.camera);
  const profile = usePlannerStore((s) => s.horizonProfile);
  const aspect = usePlannerStore((s) => s.viewportAspect);
  const setPitch = usePlannerStore((s) => s.setPitch);
  const levelY = levelLineY(camera, aspect);
  const levelText =
    levelY === null
      ? `Level is ${camera.pitchDeg > 0 ? 'below' : 'above'} the frame`
      : Math.abs(levelY) < 0.02
        ? 'Level through the centre'
        : Math.abs(Math.abs(levelY) - 1 / 3) < 0.02
          ? `Level on the ${levelY < 0 ? 'low' : 'high'} third`
          : `Level ${Math.round(((levelY + 1) / 2) * 100)}% up the frame`;
  return (
    <div className="mt-2 space-y-1.5 text-xs" data-testid="level-controls">
      <p
        role="status"
        aria-live="polite"
        className="text-[var(--lm-text-muted)]"
        data-testid="level-status"
      >
        {levelText}
      </p>
      <div role="group" aria-label="Put the horizon on" className="flex gap-1">
        {HORIZON_PLACEMENTS.map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant="secondary"
            onClick={() => setPitch(pitchForHorizonAt(p.y, camera.fovDeg, aspect))}
            data-testid={`level-${p.id}`}
          >
            {p.label}
          </Button>
        ))}
      </div>
      {profile ? (
        <p className="text-[11px] text-[var(--lm-text-muted)]">
          <span aria-hidden className="text-[var(--lm-sun)]">
            ┄
          </span>{' '}
          Dotted line: modelled ridge (terrain only).
        </p>
      ) : null}
    </div>
  );
}

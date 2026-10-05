'use client';
import { utcToLocalSelection } from '@lightmap/astronomy';
import type { ProjectDto } from '@/lib/api-types';
import { shootCountdown, shortCivilDate } from '@/features/projects/shoot-countdown';
import { useCapabilities } from '@/features/planner/use-scene';
import { deviceTimeZone } from '@/features/planner/store';
import { cx } from '@lightmap/ui';

export function ProjectCard({
  project,
  selected,
  onSelect,
}: {
  project: ProjectDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const caps = useCapabilities();
  const shootDate = project.shootDate;
  // "Shoot 24 Oct · in 19 days · forecast from 9 Oct": the date's distance and the forecast's
  // reach, from today's civil date where the reader is (the card is read on the device, not at
  // the place). Recomputed on every render — a drawer left open across midnight stays right.
  const today = utcToLocalSelection(new Date(), deviceTimeZone()).date;
  const countdown = shootDate ? shootCountdown(shootDate, today, caps.data?.weather ?? null) : null;
  const label = shootDate
    ? shortCivilDate(shootDate, shootDate.slice(0, 4) !== today.slice(0, 4))
    : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        'w-full rounded-[var(--lm-radius-sm)] border p-3 text-left transition-colors',
        selected
          ? 'border-[var(--lm-sun)]/60 bg-white/8'
          : 'border-[var(--lm-panel-border)] bg-white/3 hover:bg-white/6',
      )}
      data-testid="project-card"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className="truncate">{project.name}</span>
        {selected ? (
          <span className="shrink-0 text-xs font-normal text-[var(--lm-sun)]">
            <span aria-hidden>✓ </span>Selected
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block text-xs text-[var(--lm-text-muted)]">
        {shootDate ? (
          <span data-testid="project-shoot">
            {`Shoot ${label}`}
            {countdown ? (
              <span
                className={
                  countdown.forecast?.kind === 'available' ? 'text-[var(--lm-ok)]' : undefined
                }
                data-testid="project-countdown"
                data-forecast={countdown.forecast?.kind}
              >
                {` · ${countdown.text}`}
              </span>
            ) : null}
            {' · '}
          </span>
        ) : null}
        {project.viewpointCount} viewpoint{project.viewpointCount === 1 ? '' : 's'}
        {project.upcomingViewpointCount > 0 ? (
          <span className="text-[var(--lm-ok)]" data-testid="project-upcoming">
            {' · '}
            <span aria-hidden>◉ </span>
            {project.upcomingViewpointCount} inside the forecast window
          </span>
        ) : null}
      </span>
    </button>
  );
}

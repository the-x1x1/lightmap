'use client';
import { useMemo } from 'react';
import type { ProjectDto } from '@/lib/api-types';
import { shootCountdown, shortCivilDate } from '@/features/projects/shoot-countdown';
import { useCapabilities } from '@/features/planner/use-scene';
import { deviceTimeZone } from '@/features/planner/store';
import { cx } from '@lightmap/ui';

/** Today's civil date where the reader is (the card is read on the device, not at the place). */
function todayOnDevice(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: deviceTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

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
  const weather = caps.data?.weather ?? null;
  const shootDate = project.shootDate;
  // "Shoot 17 Oct · in 12 days · forecast from 13 Oct": the date's distance and the forecast's reach.
  const { countdown, label } = useMemo(() => {
    if (!shootDate) return { countdown: null, label: null };
    const today = todayOnDevice();
    return {
      countdown: shootCountdown(shootDate, today, weather),
      label: shortCivilDate(shootDate, shootDate.slice(0, 4) !== today.slice(0, 4)),
    };
  }, [shootDate, weather]);
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

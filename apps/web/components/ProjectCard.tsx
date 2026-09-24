import type { ProjectDto } from '@/lib/api-types';
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
        {project.shootDate ? `Shoot ${project.shootDate} · ` : ''}
        {project.viewpointCount} viewpoint{project.viewpointCount === 1 ? '' : 's'}
      </span>
    </button>
  );
}

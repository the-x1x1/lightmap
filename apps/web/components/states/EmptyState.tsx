import type { ReactNode } from 'react';

export function EmptyState({
  title,
  body,
  action,
  headingLevel = 2,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  /** Keep the outline valid when nested under another heading. */
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className="max-w-sm rounded-[var(--lm-radius)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel)]/90 p-5 text-center shadow-[var(--lm-shadow)]">
      <Heading className="text-base font-semibold">{title}</Heading>
      {body ? <p className="mt-1.5 text-sm text-[var(--lm-text-muted)]">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

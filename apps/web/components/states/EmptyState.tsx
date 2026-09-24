import type { ReactNode } from 'react';

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="max-w-sm rounded-[var(--lm-radius)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel)]/90 p-5 text-center shadow-[var(--lm-shadow)]">
      <h2 className="text-base font-semibold">{title}</h2>
      {body ? <p className="mt-1.5 text-sm text-[var(--lm-text-muted)]">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

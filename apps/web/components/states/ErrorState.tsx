import type { ReactNode } from 'react';

/** A recoverable message (plan §34): says what is unavailable and what still works. */
export function ErrorState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-[var(--lm-radius-sm)] border border-[color:rgba(242,109,109,0.4)] bg-[color:rgba(242,109,109,0.12)] p-3 text-sm">
      <p className="font-medium text-[color:#ffb3b3]">{title}</p>
      {body ? <p className="mt-1 text-[var(--lm-text-muted)]">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

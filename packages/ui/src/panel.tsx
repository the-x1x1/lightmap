import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.ts';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  raised?: boolean;
  children: ReactNode;
}

export function Panel({ raised, className, children, ...rest }: PanelProps) {
  return (
    <div className={cx('rounded-[var(--lm-radius)] border border-[var(--lm-panel-border)] shadow-[var(--lm-shadow)]', raised ? 'bg-[var(--lm-panel-raised)]' : 'bg-[var(--lm-panel)]', className)} {...rest}>
      {children}
    </div>
  );
}

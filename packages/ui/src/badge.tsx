import type { ReactNode } from 'react';
import { cx } from './cx.ts';

export type BadgeTone = 'neutral' | 'sun' | 'twilight' | 'ok' | 'warn' | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  /** Icon glyph or shape so state is not colour-only (plan §28). */
  icon?: ReactNode;
  title?: string;
}

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-white/8 text-[var(--lm-text)] ring-white/10',
  sun: 'bg-[color:rgba(245,179,66,0.16)] text-[var(--lm-sun)] ring-[color:rgba(245,179,66,0.35)]',
  twilight: 'bg-[color:rgba(91,141,239,0.16)] text-[color:#9dbcff] ring-[color:rgba(91,141,239,0.35)]',
  ok: 'bg-[color:rgba(88,196,138,0.16)] text-[color:#8fe0b3] ring-[color:rgba(88,196,138,0.35)]',
  warn: 'bg-[color:rgba(245,179,66,0.12)] text-[color:#ffd27a] ring-[color:rgba(245,179,66,0.3)]',
  danger: 'bg-[color:rgba(242,109,109,0.16)] text-[color:#ff9b9b] ring-[color:rgba(242,109,109,0.35)]',
};

export function Badge({ tone = 'neutral', children, className, icon, title }: BadgeProps) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-wide ring-1 ring-inset', tones[tone], className)}>
      {icon ? <span aria-hidden className="inline-flex">{icon}</span> : null}
      {children}
    </span>
  );
}

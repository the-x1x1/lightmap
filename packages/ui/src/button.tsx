import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.ts';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const variants = {
  primary: 'bg-[var(--lm-sun)] text-[#1a1200] hover:bg-[#ffc55c] active:bg-[var(--lm-sun-deep)]',
  secondary:
    'bg-white/10 text-[var(--lm-text)] hover:bg-white/15 active:bg-white/20 ring-1 ring-inset ring-white/10',
  ghost: 'bg-transparent text-[var(--lm-text-muted)] hover:text-[var(--lm-text)] hover:bg-white/8',
  danger:
    'bg-[color:rgba(242,109,109,0.18)] text-[color:#ffb3b3] hover:bg-[color:rgba(242,109,109,0.3)] ring-1 ring-inset ring-[color:rgba(242,109,109,0.4)]',
};
const sizes = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-4 text-sm', lg: 'h-12 px-5 text-base' };

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--lm-radius-sm)] font-medium transition-colors focus-visible:outline-none focus-visible:[box-shadow:var(--lm-focus)] disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

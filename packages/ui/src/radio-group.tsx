import { useId, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { useRovingRadio } from './use-roving-radio.ts';

export interface RadioOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Accessible name when `label` is not plain text (e.g. "24" → "24 mm"). */
  ariaLabel?: string;
  /** Rendered but not selectable; `lockedReason` is announced and shown as a tooltip. */
  locked?: boolean;
  lockedReason?: string;
  testId?: string;
}

export interface RadioGroupProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: ReadonlyArray<RadioOption<V>>;
  /** Accessible name of the group (required). */
  ariaLabel: string;
  /** 'pill' = segmented control; 'chips' = wrapping row of chips; 'grid' = equal columns. */
  variant?: 'pill' | 'chips' | 'grid';
  columns?: 2 | 3 | 5;
  className?: string;
  testId?: string;
}

/**
 * Accessible single-choice group (WAI-ARIA radio group pattern, plan §28): one Tab stop, arrow
 * keys move the selection, Home/End jump, Space/Enter select. Selected state is conveyed by
 * `aria-checked`, a filled background *and* a check glyph — never colour alone. Locked options
 * stay focusable so keyboard and screen-reader users hear why they are unavailable.
 */
export function RadioGroup<V extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  variant = 'pill',
  columns = 3,
  className,
  testId,
}: RadioGroupProps<V>) {
  const id = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const itemProps = useRovingRadio(
    options.length,
    selectedIndex,
    (i) => {
      const opt = options[i];
      if (opt && !opt.locked) onChange(opt.value);
    },
    (i) => options[i]?.locked === true,
  );

  const shell =
    variant === 'pill'
      ? 'inline-flex rounded-full bg-white/8 p-0.5 ring-1 ring-inset ring-white/10'
      : variant === 'chips'
        ? 'flex flex-wrap gap-1.5'
        : cx(
            'grid gap-1',
            columns === 2 && 'grid-cols-2',
            columns === 3 && 'grid-cols-3',
            columns === 5 && 'grid-cols-5',
          );

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(shell, className)}
      data-testid={testId}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        const reasonId = o.locked && o.lockedReason ? `${id}-${i}-reason` : undefined;
        const roving = itemProps(i);
        return (
          <button
            key={o.value}
            ref={roving.ref}
            tabIndex={roving.tabIndex}
            onKeyDown={roving.onKeyDown}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={o.locked || undefined}
            aria-describedby={reasonId}
            aria-label={o.ariaLabel}
            title={o.locked ? o.lockedReason : undefined}
            onClick={() => {
              if (!o.locked) onChange(o.value);
            }}
            className={cx(
              'inline-flex h-9 items-center justify-center gap-1 text-sm focus-visible:outline-none focus-visible:[box-shadow:var(--lm-focus)]',
              variant === 'pill' ? 'rounded-full px-3' : 'rounded-[var(--lm-radius-sm)] px-2.5',
              variant !== 'pill' && !checked && 'ring-1 ring-inset ring-white/10',
              checked
                ? variant === 'pill'
                  ? 'bg-[var(--lm-text)] font-medium text-[var(--lm-chrome)]'
                  : 'bg-white/14 font-medium text-[var(--lm-text)] ring-1 ring-inset ring-white/25'
                : 'text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]',
              o.locked && 'cursor-not-allowed opacity-50',
            )}
            data-testid={o.testId}
          >
            {checked && variant !== 'pill' ? (
              <span aria-hidden className="text-[var(--lm-sun)]">
                ✓
              </span>
            ) : null}
            {o.label}
            {reasonId ? (
              <span id={reasonId} className="sr-only">
                {o.lockedReason}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

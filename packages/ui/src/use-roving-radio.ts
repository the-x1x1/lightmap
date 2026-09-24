import { useCallback, useRef, type KeyboardEvent } from 'react';

export interface RovingItemProps {
  tabIndex: 0 | -1;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  ref: (el: HTMLElement | null) => void;
}

/**
 * Keyboard behaviour of the WAI-ARIA radio group pattern for a row of `role="radio"` buttons
 * (plan §28): one Tab stop (the selected item), ←/↑ and →/↓ move selection and focus, Home/End
 * jump. Items flagged in `locked` are skipped. Rendering stays with the caller, so bespoke pills
 * (scenario chips, lens presets) keep their look and test ids.
 */
export function useRovingRadio(
  count: number,
  selectedIndex: number,
  onSelect: (index: number) => void,
  locked: (index: number) => boolean = () => false,
): (index: number) => RovingItemProps {
  const refs = useRef<Array<HTMLElement | null>>([]);

  const move = useCallback(
    (from: number, delta: number) => {
      if (count === 0) return;
      let i = from;
      for (let k = 0; k < count; k++) {
        i = (((i + delta) % count) + count) % count;
        if (!locked(i)) break;
      }
      if (locked(i)) return;
      refs.current[i]?.focus();
      onSelect(i);
    },
    [count, locked, onSelect],
  );

  return useCallback(
    (index: number): RovingItemProps => ({
      tabIndex: index === Math.max(0, selectedIndex) ? 0 : -1,
      ref: (el) => {
        refs.current[index] = el;
      },
      onKeyDown: (e) => {
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            e.preventDefault();
            move(index, 1);
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            e.preventDefault();
            move(index, -1);
            break;
          case 'Home':
            e.preventDefault();
            move(-1, 1);
            break;
          case 'End':
            e.preventDefault();
            move(count, -1);
            break;
          default:
        }
      },
    }),
    [count, move, selectedIndex],
  );
}

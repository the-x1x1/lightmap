import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettled } from '@/lib/use-settled';

describe('useSettled', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes the first value at once and follows later ones only after they hold still', () => {
    const { result, rerender } = renderHook(({ v }) => useSettled(v, 300), {
      initialProps: { v: '2026-05-31' },
    });
    expect(result.current).toBe('2026-05-31');
    rerender({ v: '2026-06-01' });
    expect(result.current).toBe('2026-05-31');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // A further change inside the window restarts the wait.
    rerender({ v: '2026-06-02' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('2026-05-31');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('2026-06-02');
    // Going back to the settled value cancels the pending change.
    rerender({ v: '2026-06-03' });
    rerender({ v: '2026-06-02' });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe('2026-06-02');
  });
});

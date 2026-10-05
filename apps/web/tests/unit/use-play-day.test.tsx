import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlayDay } from '@/features/planner/use-play-day';
import { usePlannerStore } from '@/features/planner/store';

describe('usePlayDay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlannerStore.getState().setMinutes(600);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the store clock at the pace while playing, honours a scrub, and stops on toggle', () => {
    const { result, unmount } = renderHook(() => usePlayDay(1440));
    expect(result.current.playing).toBe(false);
    expect(result.current.rate).toBe(10);
    act(() => {
      result.current.toggle();
    });
    expect(result.current.playing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(usePlannerStore.getState().minutes).toBe(610);
    // A scrub while playing: the clock continues from the thumb.
    act(() => {
      usePlannerStore.getState().setMinutes(100);
      vi.advanceTimersByTime(500);
    });
    expect(usePlannerStore.getState().minutes).toBe(105);
    act(() => {
      result.current.toggle();
    });
    expect(result.current.playing).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(usePlannerStore.getState().minutes).toBe(105);
    unmount();
  });

  it('changes pace on the fly and wraps at midnight', () => {
    const { result, unmount } = renderHook(() => usePlayDay(1440));
    act(() => {
      result.current.cycleRate();
    });
    expect(result.current.rate).toBe(60);
    act(() => {
      usePlannerStore.getState().setMinutes(1430);
      result.current.toggle();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 1430 + 60 − 1440
    expect(usePlannerStore.getState().minutes).toBe(50);
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(usePlannerStore.getState().minutes).toBe(50);
  });
});

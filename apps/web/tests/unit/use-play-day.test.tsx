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

  it('changes pace mid-play and wraps at midnight', () => {
    const { result, unmount } = renderHook(() => usePlayDay(1440));
    act(() => {
      usePlannerStore.getState().setMinutes(1400);
      result.current.toggle();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(usePlannerStore.getState().minutes).toBe(1410);
    act(() => {
      result.current.cycleRate();
    });
    expect(result.current.rate).toBe(60);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 1410 + 60 − 1440
    expect(usePlannerStore.getState().minutes).toBe(30);
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(usePlannerStore.getState().minutes).toBe(30);
  });

  it('plays a 25-hour day as 24: the store holds 0–1439, so the clock wraps there', () => {
    const { result, unmount } = renderHook(() => usePlayDay(1500));
    act(() => {
      usePlannerStore.getState().setMinutes(1435);
      result.current.toggle();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(usePlannerStore.getState().minutes).toBe(5);
    unmount();
  });

  it('waits while the thumb is held and resumes from the drop point', () => {
    const { result, unmount } = renderHook(() => usePlayDay(1440));
    act(() => {
      usePlannerStore.getState().setMinutes(300);
      result.current.toggle();
    });
    act(() => {
      result.current.hold(true);
    });
    act(() => {
      usePlannerStore.getState().setMinutes(900);
      vi.advanceTimersByTime(2000);
    });
    expect(usePlannerStore.getState().minutes).toBe(900);
    act(() => {
      result.current.hold(false);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(usePlannerStore.getState().minutes).toBe(910);
    unmount();
  });

  it('counts at most a second of real time per tick, so a hidden tab does not leap', () => {
    const { result, unmount } = renderHook(() => usePlayDay(1440));
    act(() => {
      usePlannerStore.getState().setMinutes(600);
      result.current.toggle();
    });
    act(() => {
      // One throttled tick after five minutes away: a second's worth, not five minutes'.
      vi.advanceTimersToNextTimer();
      vi.setSystemTime(Date.now() + 5 * 60_000);
      vi.advanceTimersToNextTimer();
    });
    expect(usePlannerStore.getState().minutes).toBe(610);
    unmount();
  });
});

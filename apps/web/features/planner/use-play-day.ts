'use client';
/**
 * Plays the day: while on, the planner's minutes advance at the chosen pace (day-minutes per
 * real second), wrapping at the end of the civil day. A scrub while playing is honoured — the
 * clock continues from wherever the thumb was dropped. Stops when the timeline unmounts.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePlannerStore } from './store';
import { DEFAULT_PLAY_RATE, PLAY_TICK_MS, advance, nextRate, type PlayRate } from './play';

export interface PlayDay {
  playing: boolean;
  rate: PlayRate;
  toggle: () => void;
  cycleRate: () => void;
}

export function usePlayDay(total = 1440): PlayDay {
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<PlayRate>(DEFAULT_PLAY_RATE);
  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    // Fractional minutes, so a slow pace still gains ground between ticks.
    let clock = usePlannerStore.getState().minutes;
    const id = setInterval(() => {
      const now = Date.now();
      const st = usePlannerStore.getState();
      // The user moved the thumb since the last tick: continue from there.
      if (Math.floor(clock) !== st.minutes) clock = st.minutes;
      clock = advance(clock, now - last, rate, total);
      last = now;
      const next = Math.floor(clock);
      if (next !== st.minutes) st.setMinutes(next);
    }, PLAY_TICK_MS);
    return () => clearInterval(id);
  }, [playing, rate, total]);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const cycleRate = useCallback(() => setRate((r) => nextRate(r)), []);
  return { playing, rate, toggle, cycleRate };
}

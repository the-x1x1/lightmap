'use client';
/**
 * Plays the day: while on, the planner's minutes advance at the chosen pace (day-minutes per
 * real second), wrapping at the end of the civil day. While the thumb is held (`hold(true)`)
 * the clock waits, and a scrub is honoured either way — playback continues from wherever the
 * thumb was dropped. Real time that passes while the tab is hidden is capped per tick, so a
 * return finds the clock near where it was. Stops when the timeline unmounts.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePlannerStore } from './store';
import { DEFAULT_PLAY_RATE, PLAY_TICK_MS, advance, nextRate, type PlayRate } from './play';

export interface PlayDay {
  playing: boolean;
  rate: PlayRate;
  toggle: () => void;
  cycleRate: () => void;
  /** True while the user holds the thumb: the clock waits and resumes from the drop point. */
  hold: (held: boolean) => void;
}

/** The store keeps minutes in 0–1439, so a 25-hour day plays as 24 and wraps there. */
const STORE_MINUTES = 1440;
/** A hidden tab's throttled ticks count for at most this much real time each. */
const MAX_TICK_MS = 1000;

export function usePlayDay(total = STORE_MINUTES): PlayDay {
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState(false);
  const [rate, setRate] = useState<PlayRate>(DEFAULT_PLAY_RATE);
  useEffect(() => {
    if (!playing || held) return;
    const span = Math.min(total, STORE_MINUTES);
    let last = Date.now();
    // Fractional minutes, so a slow pace still gains ground between ticks.
    let clock = usePlannerStore.getState().minutes;
    const id = setInterval(() => {
      const now = Date.now();
      const st = usePlannerStore.getState();
      // The user moved the thumb since the last tick: continue from there.
      if (Math.floor(clock) !== st.minutes) clock = st.minutes;
      clock = advance(clock, Math.min(now - last, MAX_TICK_MS), rate, span);
      last = now;
      const next = Math.floor(clock);
      if (next !== st.minutes) st.setMinutes(next);
    }, PLAY_TICK_MS);
    return () => clearInterval(id);
  }, [playing, held, rate, total]);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const cycleRate = useCallback(() => setRate((r) => nextRate(r)), []);
  const hold = useCallback((h: boolean) => setHeld(h), []);
  return { playing, rate, toggle, cycleRate, hold };
}

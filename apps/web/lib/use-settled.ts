'use client';
/**
 * A value that follows `value` only once it has stopped changing for `ms` (trailing settle). The
 * first value is taken at once. Used to keep continuous controls — the day-of-year slider, the
 * timeline — from firing a network request or a long scan on every tick while the cheap,
 * instantaneous astronomy keeps following the live value.
 */
import { useEffect, useState } from 'react';

export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return;
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms, settled]);
  return settled;
}

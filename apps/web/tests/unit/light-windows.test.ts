import { describe, expect, it } from 'vitest';
import { computeDayEvents } from '@lightmap/astronomy';
import { describeLightWindows } from '../../features/planner/light-windows.ts';

describe('light windows line', () => {
  it('names both golden hours and both blue hours with their lengths at Kailua', () => {
    const ev = computeDayEvents({
      latitude: 21.397,
      longitude: -157.727,
      timeZone: 'Pacific/Honolulu',
      date: { year: 2026, month: 5, day: 31 },
    });
    const line = describeLightWindows(ev, 'Pacific/Honolulu')!;
    expect(line).toMatch(
      /^Golden hour \d\d:\d\d–\d\d:\d\d \(\d+ min\) · \d\d:\d\d–\d\d:\d\d \(\d+ min\); blue hour \d\d:\d\d–05:48 \(\d+ min\) · 19:09–\d\d:\d\d \(\d+ min\)$/,
    );
    // Near the tropics the golden hour is short: well under an hour each.
    const mins = [...line.matchAll(/\((\d+) min\)/g)].map((m) => Number(m[1]));
    expect(mins).toHaveLength(4);
    for (const m of mins) expect(m).toBeGreaterThan(15);
    for (const m of mins) expect(m).toBeLessThan(60);
  });

  it('leaves out windows that do not occur: midnight sun has no blue hour', () => {
    const tromso = computeDayEvents({
      latitude: 69.6492,
      longitude: 18.9553,
      timeZone: 'Europe/Oslo',
      date: { year: 2026, month: 6, day: 21 },
    });
    const line = describeLightWindows(tromso, 'Europe/Oslo');
    expect(line === null || !line.includes('blue hour')).toBe(true);
    // Polar night in December: no sunrise, so no golden or blue hour by these definitions.
    const dark = computeDayEvents({
      latitude: 78.2,
      longitude: 15.6,
      timeZone: 'Arctic/Longyearbyen',
      date: { year: 2026, month: 12, day: 21 },
    });
    expect(describeLightWindows(dark, 'Arctic/Longyearbyen')).toBeNull();
  });
});

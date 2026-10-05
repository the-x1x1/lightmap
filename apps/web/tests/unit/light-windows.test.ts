import { describe, expect, it } from 'vitest';
import { computeDayEvents } from '@lightmap/astronomy';
import { describeLightWindows, lightWindows } from '../../features/planner/light-windows.ts';

const day = (lat: number, lon: number, tz: string, y: number, m: number, d: number) => ({
  ev: computeDayEvents({
    latitude: lat,
    longitude: lon,
    timeZone: tz,
    date: { year: y, month: m, day: d },
  }),
  point: { latitude: lat, longitude: lon },
  tz,
});

describe('light windows', () => {
  it('names both golden hours and both blue hours with their lengths at Kailua', () => {
    const k = day(21.397, -157.727, 'Pacific/Honolulu', 2026, 5, 31);
    expect(describeLightWindows(k.ev, k.point, k.tz)).toBe(
      'Golden hour 05:33–06:20 (47 min) · 18:37–19:24 (47 min); blue hour 05:23–05:33 (10 min) · 19:24–19:33 (10 min)',
    );
    // Edges are the day events' own crossings, not sample times.
    const w = lightWindows(k.ev, k.point);
    expect(w.golden[0]!.start.getTime()).toBe(k.ev.goldenHourMorningStart!.getTime());
    expect(w.golden[1]!.end.getTime()).toBe(k.ev.goldenHourEveningEnd!.getTime());
    expect(w.blue[0]!.start.getTime()).toBe(k.ev.dawn!.getTime());
    expect(w.blue[1]!.end.getTime()).toBe(k.ev.civilDusk!.getTime());
  });

  it('snaps each band to its own edges where the blue band is narrower than the sampling step', () => {
    // Kailua in January: dawn → golden-hour start is 9 minutes; the evening blue hour must not
    // vanish into the golden hour's close.
    const k = day(21.397, -157.727, 'Pacific/Honolulu', 2026, 1, 16);
    const w = lightWindows(k.ev, k.point);
    expect(w.blue).toHaveLength(2);
    expect(w.golden).toHaveLength(2);
    expect(w.blue[0]!.start.getTime()).toBe(k.ev.dawn!.getTime());
    expect(w.blue[0]!.end.getTime()).toBe(k.ev.goldenHourMorningStart!.getTime());
    expect(w.golden[1]!.end.getTime()).toBe(k.ev.goldenHourEveningEnd!.getTime());
    expect(w.blue[1]!.start.getTime()).toBe(k.ev.goldenHourEveningEnd!.getTime());
    expect(w.blue[1]!.end.getTime()).toBe(k.ev.civilDusk!.getTime());
    // The same holds every day of the year at the equator, where the bands are narrowest.
    for (let m = 1; m <= 12; m++) {
      const e = day(0, 0, 'Africa/Accra', 2026, m, 15);
      const ww = lightWindows(e.ev, e.point);
      expect(ww.blue.map((x) => [x.start.getTime(), x.end.getTime()])).toEqual([
        [e.ev.dawn!.getTime(), e.ev.goldenHourMorningStart!.getTime()],
        [e.ev.goldenHourEveningEnd!.getTime(), e.ev.civilDusk!.getTime()],
      ]);
      expect(ww.golden.map((x) => [x.start.getTime(), x.end.getTime()])).toEqual([
        [e.ev.goldenHourMorningStart!.getTime(), e.ev.goldenHourMorningEnd!.getTime()],
        [e.ev.goldenHourEveningStart!.getTime(), e.ev.goldenHourEveningEnd!.getTime()],
      ]);
    }
  });

  it('keeps windows that straddle midnight or never cross an edge inside the day', () => {
    // Midnight sun at Tromsø: the Sun dips to 3° — golden light runs through midnight, no blue hour.
    const t = day(69.6492, 18.9553, 'Europe/Oslo', 2026, 6, 21);
    expect(describeLightWindows(t.ev, t.point, t.tz)).toMatch(
      /^Golden hour 00:00–0\d:\d\d \(\d+ min\) · 2\d:\d\d–24:00 \(\d+ min\)$/,
    );
    // Oslo: the evening blue hour runs past midnight, so the day has a blue spell at each end.
    const o = day(59.91, 10.75, 'Europe/Oslo', 2026, 6, 21);
    const line = describeLightWindows(o.ev, o.point, o.tz)!;
    expect(line).toMatch(
      /blue hour 00:00–00:\d\d \(\d+ min\) · 0\d:\d\d–0\d:\d\d \(\d+ min\) · 23:\d\d–24:00 \(\d+ min\)$/,
    );
    // Polar night at Tromsø still has a civil-twilight noon in the bands; deep polar night has none.
    const pn = day(69.6492, 18.9553, 'Europe/Oslo', 2026, 12, 21);
    expect(describeLightWindows(pn.ev, pn.point, pn.tz)).toMatch(/^Golden hour 1\d:\d\d–1\d:\d\d/);
    const deep = day(78.2, 15.6, 'Arctic/Longyearbyen', 2026, 12, 21);
    expect(describeLightWindows(deep.ev, deep.point, deep.tz)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { computeDayEvents, milkyWayCore } from '@lightmap/astronomy';
import { darkSkyBand, darkSkySpells } from '../../features/planner/dark-sky-band.ts';

const KAILUA = { latitude: 21.397, longitude: -157.727, timeZone: 'Pacific/Honolulu' };

describe('dark-sky band on the timeline', () => {
  it('marks both ends of the new-Moon night inside the civil day, and nothing on a full-Moon day', () => {
    const ev = computeDayEvents({ ...KAILUA, date: { year: 2026, month: 6, day: 15 } });
    const spells = darkSkySpells(ev, KAILUA.latitude, KAILUA.longitude);
    // Before dawn (the tail of the 14/15 June night) and after dusk (the start of the next).
    expect(spells.length).toBe(2);
    expect(spells[0]!.from.getTime()).toBe(ev.dayStart.getTime());
    expect(spells[1]!.to.getTime()).toBeGreaterThanOrEqual(ev.dayEnd.getTime() - 60_000);
    for (const s of spells) {
      expect(s.from.getTime()).toBeGreaterThanOrEqual(ev.dayStart.getTime());
      expect(s.to.getTime()).toBeLessThanOrEqual(ev.dayEnd.getTime());
      const mid = new Date((s.from.getTime() + s.to.getTime()) / 2);
      expect(milkyWayCore(mid, KAILUA.latitude, KAILUA.longitude).verdict).toBe('visible');
    }
    const band = darkSkyBand(ev, spells);
    expect(band).toMatch(/^linear-gradient\(90deg, rgba\(201,184,255,0\) 0%, /);
    expect(band).toContain('rgba(201,184,255,0.45) 0.00%');
    expect(band).toMatch(/100\.00%, rgba\(201,184,255,0\) 100%\)$/);
    // 7 June: the night's window ends ten minutes after midnight — the short head of the civil
    // day is kept (judged as part of the whole night, not on its own).
    const june7 = computeDayEvents({ ...KAILUA, date: { year: 2026, month: 6, day: 7 } });
    const head = darkSkySpells(june7, KAILUA.latitude, KAILUA.longitude)[0]!;
    expect(head.from.getTime()).toBe(june7.dayStart.getTime());
    expect(head.to.getTime() - head.from.getTime()).toBeLessThan(20 * 60_000);
    expect(head.to.getTime() - head.from.getTime()).toBeGreaterThan(0);
    // 31 May 2026: full Moon up all night — no band.
    const full = computeDayEvents({ ...KAILUA, date: { year: 2026, month: 5, day: 31 } });
    expect(darkSkySpells(full, KAILUA.latitude, KAILUA.longitude)).toEqual([]);
    expect(darkSkyBand(full, [])).toBeNull();
  });
});

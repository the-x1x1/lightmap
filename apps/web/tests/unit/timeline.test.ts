import { describe, expect, it } from 'vitest';
import { computeDayEvents } from '@lightmap/astronomy';
import { dayGradient, dayMarkers } from '@/components/Timeline';

describe('timeline markers', () => {
  const ev = computeDayEvents({ latitude: 21.397, longitude: -157.727, timeZone: 'Pacific/Honolulu', date: { year: 2026, month: 5, day: 31 } });
  it('places sunrise/noon/sunset in order within the day', () => {
    const m = dayMarkers(ev);
    const keys = m.map((x) => x.key);
    expect(keys).toEqual(['dawn', 'sunrise', 'goldenEnd', 'noon', 'goldenStart', 'sunset', 'dusk']);
    for (let i = 1; i < m.length; i++) expect(m[i]!.minutes).toBeGreaterThan(m[i - 1]!.minutes);
    expect(m.find((x) => x.key === 'sunrise')!.minutes).toBeCloseTo(5 * 60 + 48, 0);
  });
  it('builds a gradient with night at both ends', () => {
    const g = dayGradient(ev);
    expect(g.startsWith('linear-gradient(90deg, #0c1230 0%')).toBe(true);
    expect(g.endsWith('#0c1230 100%)')).toBe(true);
  });
  it('handles polar days without markers', () => {
    const tromso = computeDayEvents({ latitude: 69.6492, longitude: 18.9553, timeZone: 'Europe/Oslo', date: { year: 2026, month: 6, day: 21 } });
    expect(dayMarkers(tromso).map((x) => x.key)).toEqual(['noon']);
    expect(dayGradient(tromso)).toContain('#6aa7e6');
  });
});

import { describe, expect, it } from 'vitest';
import { dateFromDayOfYear, dayOfYear, daysInYear } from '../../lib/civil-year.ts';

describe('civil year (day-of-year scrubber)', () => {
  it('knows leap years, including the century rules', () => {
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2028)).toBe(366);
    expect(daysInYear(2100)).toBe(365);
    expect(daysInYear(2000)).toBe(366);
  });

  it('maps dates to day numbers and back, across the leap day', () => {
    expect(dayOfYear({ year: 2026, month: 1, day: 1 })).toBe(1);
    expect(dayOfYear({ year: 2026, month: 5, day: 31 })).toBe(151);
    expect(dayOfYear({ year: 2026, month: 12, day: 31 })).toBe(365);
    expect(dayOfYear({ year: 2028, month: 3, day: 1 })).toBe(61);
    expect(dateFromDayOfYear(2026, 151)).toBe('2026-05-31');
    expect(dateFromDayOfYear(2028, 60)).toBe('2028-02-29');
    expect(dateFromDayOfYear(2028, 366)).toBe('2028-12-31');
    for (const y of [2026, 2028]) {
      for (let n = 1; n <= daysInYear(y); n += 7) {
        const d = dateFromDayOfYear(y, n);
        const [yy, mm, dd] = d.split('-').map(Number) as [number, number, number];
        expect(dayOfYear({ year: yy, month: mm, day: dd })).toBe(n);
      }
    }
  });

  it('clamps out-of-range day numbers to the year', () => {
    expect(dateFromDayOfYear(2026, 0)).toBe('2026-01-01');
    expect(dateFromDayOfYear(2026, 400)).toBe('2026-12-31');
    expect(dateFromDayOfYear(2026, 151.4)).toBe('2026-05-31');
  });
});

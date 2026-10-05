import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAY_RATE,
  PLAY_RATES,
  advance,
  describeRate,
  nextRate,
} from '@/features/planner/play';

describe('playing the day', () => {
  it('advances by elapsed real time at the pace, keeping fractions', () => {
    expect(advance(600, 1000, 10)).toBe(610);
    expect(advance(600, 50, 2)).toBeCloseTo(600.1, 9);
    expect(advance(600.9, 10, 10)).toBeCloseTo(601, 9);
  });

  it('wraps at the end of the civil day, whatever its length', () => {
    expect(advance(1439, 2000, 60)).toBe(119); // 1439 + 120 − 1440
    expect(advance(1379, 1000, 2, 1380)).toBe(1); // a 23-hour DST day
    expect(advance(0, 1000 * 144, 10)).toBe(0); // exactly one day round
  });

  it('stands still on nonsense input', () => {
    expect(advance(600, 0, 10)).toBe(600);
    expect(advance(600, -5, 10)).toBe(600);
    expect(advance(600, Number.NaN, 10)).toBe(600);
    expect(advance(600, 1000, 0)).toBe(600);
    expect(advance(600, 1000, 10, 0)).toBe(600);
  });

  it('cycles the three paces and names them', () => {
    expect(PLAY_RATES).toEqual([2, 10, 60]);
    expect(DEFAULT_PLAY_RATE).toBe(10);
    expect(nextRate(2)).toBe(10);
    expect(nextRate(10)).toBe(60);
    expect(nextRate(60)).toBe(2);
    expect(describeRate(10)).toBe('10 min/s');
  });
});

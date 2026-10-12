import { describe, expect, it } from 'vitest';
import { LIVE_WITHIN_MS, describePlannedOffset } from '../../features/field/planned-offset.ts';

const MIN = 60_000;
const H = 60 * MIN;

describe('describePlannedOffset', () => {
  it('is live within a minute and a half either way', () => {
    expect(describePlannedOffset(1000, 1000)).toBeNull();
    expect(describePlannedOffset(LIVE_WITHIN_MS - 1, 0)).toBeNull();
    expect(describePlannedOffset(-(LIVE_WITHIN_MS - 1), 0)).toBeNull();
    expect(describePlannedOffset(LIVE_WITHIN_MS, 0)).toBe('in 2 min');
  });

  it('counts minutes, then hours and minutes, then days and hours, ahead or ago', () => {
    expect(describePlannedOffset(4 * MIN, 0)).toBe('in 4 min');
    expect(describePlannedOffset(0, 32 * MIN)).toBe('32 min ago');
    expect(describePlannedOffset(72 * MIN, 0)).toBe('in 1 h 12 min');
    expect(describePlannedOffset(3 * H, 0)).toBe('in 3 h');
    expect(describePlannedOffset(0, 3 * H + 30 * MIN)).toBe('3 h 30 min ago');
    expect(describePlannedOffset(2 * 24 * H + 5 * H + 20 * MIN, 0)).toBe('in 2 d 5 h');
    expect(describePlannedOffset(0, 24 * H)).toBe('1 d ago');
    // Rounded to the minute: 59 min 40 s reads as an hour.
    expect(describePlannedOffset(59 * MIN + 40_000, 0)).toBe('in 1 h');
    // A custom live window.
    expect(describePlannedOffset(5 * MIN, 0, 10 * MIN)).toBeNull();
  });
});

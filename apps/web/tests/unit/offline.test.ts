import { describe, expect, it } from 'vitest';
import { describeCachedAt } from '@/lib/client/offline';

describe('offline banner text', () => {
  const now = new Date(2026, 9, 4, 18, 30);
  it('says the time for data cached today and the date for older data', () => {
    expect(describeCachedAt(new Date(2026, 9, 4, 14, 5).toISOString(), now)).toMatch(
      /^saved data from \S/,
    );
    const older = describeCachedAt(new Date(2026, 9, 1, 9, 0).toISOString(), now)!;
    expect(older).toMatch(/^saved data from .+, /);
    expect(older).not.toBe(describeCachedAt(new Date(2026, 9, 4, 9, 0).toISOString(), now));
  });
  it('returns null for missing or garbled timestamps', () => {
    expect(describeCachedAt(null)).toBeNull();
    expect(describeCachedAt('not a date')).toBeNull();
  });
});

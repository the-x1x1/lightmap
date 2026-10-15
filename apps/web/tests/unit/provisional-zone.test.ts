import { describe, expect, it } from 'vitest';
import { provisionalTimeZone, samePoint } from '../../features/planner/provisional-zone.ts';

describe('provisional time zone', () => {
  const tokyo = { point: { latitude: 35.68, longitude: 139.69 }, timeZone: 'Asia/Tokyo' };
  it('keeps the previous zone for a nearby pick', () => {
    expect(provisionalTimeZone({ latitude: 35.7, longitude: 139.8 }, tokyo)).toBe('Asia/Tokyo');
  });
  it('estimates a far place from its longitude, never the old place’s zone', () => {
    // Kiritimati, 157.4° W: a nautical UTC-10 until the lookup answers UTC+14.
    expect(provisionalTimeZone({ latitude: 1.87, longitude: -157.4 }, tokyo)).toBe('Etc/GMT+10');
    expect(provisionalTimeZone({ latitude: 35.68, longitude: 139.69 }, null)).toBe('Etc/GMT-9');
    expect(provisionalTimeZone({ latitude: 51.5, longitude: -0.1 }, null)).toBe('Etc/GMT');
    // Every estimate is a zone Intl knows.
    for (const lon of [-179, -120, -7.4, 7.6, 100, 179.9])
      expect(
        () =>
          new Intl.DateTimeFormat('en', {
            timeZone: provisionalTimeZone({ latitude: 0, longitude: lon }, null),
          }),
      ).not.toThrow();
  });
  it('knows whether the planner still stands where a lookup was asked for', () => {
    expect(samePoint({ latitude: 1, longitude: 2 }, { latitude: 1, longitude: 2 })).toBe(true);
    expect(samePoint({ latitude: 1, longitude: 2.0001 }, { latitude: 1, longitude: 2 })).toBe(
      false,
    );
    expect(samePoint(null, { latitude: 1, longitude: 2 })).toBe(false);
  });
});

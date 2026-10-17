import { describe, expect, it } from 'vitest';
import { findDirectionMatches } from '../src/solver.ts';

// Kailua, Oahu, June 2026: Venus and Jupiter set together in the WNW after dusk, a week before
// their conjunction of 9 June.
const kailua = { latitude: 21.397, longitude: -157.727, timeZone: 'Pacific/Honolulu' };

describe('the finder with a planet', () => {
  it('finds Venus setting through 293 deg, 7 deg up, each evening of early June 2026', () => {
    const r = findDirectionMatches({
      ...kailua,
      from: { year: 2026, month: 6, day: 1 },
      to: { year: 2026, month: 6, day: 5 },
      body: 'venus',
      target: {
        azimuthDegrees: 293,
        azimuthToleranceDegrees: 1,
        elevationDegrees: 7,
        elevationToleranceDegrees: 1.5,
      },
    });
    expect(r.matches.length).toBeGreaterThanOrEqual(4);
    for (const m of r.matches) {
      expect(m.body).toBe('venus');
      expect(m.trend).toBe('setting');
      expect(m.sky).toBe('dark');
      // After dusk (07:00-07:20 UTC is 21:00-21:20 HST).
      const hst = (m.timestampUtc.getUTCHours() + 14) % 24;
      expect(hst).toBe(21);
    }
  });

  it('keeps only the instants the planet can be seen, unless asked for all', () => {
    const base = {
      ...kailua,
      from: { year: 2026, month: 6, day: 1 },
      to: { year: 2026, month: 6, day: 3 },
      body: 'jupiter' as const,
      target: { azimuthDegrees: 293, azimuthToleranceDegrees: 3 },
    };
    const seen = findDirectionMatches(base);
    const all = findDirectionMatches({ ...base, darkSkyOnly: false });
    expect(all.matches.length).toBeGreaterThan(seen.matches.length);
    expect(seen.matches.every((m) => m.sky === 'dark')).toBe(true);
    // Jupiter crosses the bearing high in the afternoon too: daylight, dropped when only the
    // visible instants are kept.
    expect(all.matches.some((m) => m.sky === 'daylight')).toBe(true);
  });

  it('says an instant is low when the air near the horizon hides a planet in a dark sky', () => {
    // Jupiter sets at about 22:00 HST in early June 2026, the Sun 20 deg down: at 0.3 deg up the
    // air dims it by about 8 magnitudes, past the naked-eye limit.
    const r = findDirectionMatches({
      ...kailua,
      from: { year: 2026, month: 6, day: 1 },
      to: { year: 2026, month: 6, day: 2 },
      body: 'jupiter',
      darkSkyOnly: false,
      minElevationDegrees: 0,
      target: {
        azimuthDegrees: 293,
        azimuthToleranceDegrees: 10,
        elevationDegrees: 0.3,
        elevationToleranceDegrees: 0.2,
      },
    });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.every((m) => m.sky === 'low')).toBe(true);
  });
});

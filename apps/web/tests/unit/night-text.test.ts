import { describe, expect, it } from 'vitest';
import { milkyWayCore } from '@lightmap/astronomy';
import { describeMilkyWay, describeNextPhases } from '../../features/planner/night-text.ts';

describe('night read-outs', () => {
  it('names where the core stands and the reason, or that it is below the horizon', () => {
    const dark = describeMilkyWay(milkyWayCore(new Date('2026-06-15T12:00:00Z'), 21.397, -157.727));
    expect(dark).toMatch(/^3\d° up S(SW|W) — Astronomical night, core 3\d° up, Moon down$/);
    const winter = describeMilkyWay(
      milkyWayCore(new Date('2026-12-15T10:00:00Z'), 21.397, -157.727),
    );
    expect(winter).toBe('below the horizon — Galactic core below the horizon');
    // Hand-built: a core just under the horizon by day.
    expect(
      describeMilkyWay({
        azimuthDeg: 100,
        elevationDeg: -0.2,
        sunElevationDeg: 30,
        moonUp: false,
        moonIlluminatedFraction: 0,
        verdict: 'daylight',
        reason: 'Daylight or civil twilight: no stars',
      }),
    ).toBe('below the horizon — Daylight or civil twilight: no stars');
  });

  it('lists the next four principal phases as dates in the given zone', () => {
    // From the start of 31 May 2026 HST: the full Moon (31 May 08:45 UTC = 30 May 22:45 HST) has
    // passed, so the list starts with the last quarter.
    const line = describeNextPhases(new Date('2026-05-31T10:00:00Z'), 'Pacific/Honolulu');
    expect(line).toMatch(
      /^Last quarter [78] Jun · New 14 Jun · First quarter 21 Jun · Full 29 Jun$/,
    );
    // The same instants in a zone a day ahead move the day numbers where midnight is crossed.
    const tokyo = describeNextPhases(new Date('2026-05-31T10:00:00Z'), 'Asia/Tokyo');
    expect(tokyo.split(' · ')).toHaveLength(4);
    expect(tokyo).toMatch(/^Last quarter 8 Jun · New 15 Jun/);
  });
});

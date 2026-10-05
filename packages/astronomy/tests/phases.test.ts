import { describe, expect, it } from 'vitest';
import { moonElongationDeg, nextMoonPhases } from '../src/phases.ts';
import { moonPosition } from '../src/lunar.ts';

const minutesApart = (a: Date, iso: string) => Math.abs(a.getTime() - Date.parse(iso)) / 60_000;

describe('principal moon phases', () => {
  it('finds the published 2026 instants to within a couple of minutes', () => {
    // USNO / almanac values (UTC).
    const p = nextMoonPhases(new Date('2026-05-20T00:00:00Z'), 4);
    expect(p.map((x) => x.phase)).toEqual(['first-quarter', 'full', 'last-quarter', 'new']);
    expect(minutesApart(p[1]!.at, '2026-05-31T08:45:00Z')).toBeLessThan(3);
    expect(minutesApart(p[3]!.at, '2026-06-15T02:54:00Z')).toBeLessThan(3);
    const q = nextMoonPhases(new Date('2026-01-01T00:00:00Z'), 3);
    expect(q[0]!.phase).toBe('full');
    expect(minutesApart(q[0]!.at, '2026-01-03T10:03:00Z')).toBeLessThan(3);
    expect(q[2]!.phase).toBe('new');
    expect(minutesApart(q[2]!.at, '2026-01-18T19:52:00Z')).toBeLessThan(3);
  });

  it('each instant sits exactly on its elongation, in order, about a week apart', () => {
    const p = nextMoonPhases(new Date('2027-03-10T12:00:00Z'), 8);
    expect(p).toHaveLength(8);
    const target = { new: 0, 'first-quarter': 90, full: 180, 'last-quarter': 270 };
    for (let i = 0; i < p.length; i++) {
      const e = p[i]!;
      const d = ((moonElongationDeg(e.at) - target[e.phase] + 180) % 360) - 180;
      expect(Math.abs(d)).toBeLessThan(0.001);
      if (i > 0) {
        const gapDays = (e.at.getTime() - p[i - 1]!.at.getTime()) / 86_400_000;
        expect(gapDays).toBeGreaterThan(6.4);
        expect(gapDays).toBeLessThan(8.4);
      }
    }
  });

  it('every instant is at or after its crossing, so the position model names that phase there', () => {
    const target = { new: 0, 'first-quarter': 90, full: 180, 'last-quarter': 270 };
    const names = {
      new: 'New Moon',
      'first-quarter': 'First Quarter',
      full: 'Full Moon',
      'last-quarter': 'Last Quarter',
    };
    for (const e of nextMoonPhases(new Date('2024-01-01T00:00:00Z'), 12)) {
      const d = ((moonElongationDeg(e.at) - target[e.phase] + 180) % 360) - 180;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(moonPosition(e.at, 0, 0).phaseName).toBe(names[e.phase]);
      // Strictly after: asking from the instant itself moves on to the next phase.
      expect(nextMoonPhases(e.at, 1)[0]!.phase).not.toBe(e.phase);
    }
  });

  it('agrees with the phase name and illumination the position model reports', () => {
    const [full] = nextMoonPhases(new Date('2026-05-25T00:00:00Z'), 4).filter(
      (x) => x.phase === 'full',
    );
    const m = moonPosition(full!.at, 21.397, -157.727);
    expect(m.phaseName).toBe('Full Moon');
    expect(m.illuminatedFraction).toBeGreaterThan(0.995);
    const [nu] = nextMoonPhases(new Date('2026-05-25T00:00:00Z'), 4).filter(
      (x) => x.phase === 'new',
    );
    expect(moonPosition(nu!.at, 21.397, -157.727).illuminatedFraction).toBeLessThan(0.005);
  });
});

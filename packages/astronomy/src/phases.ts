/**
 * Principal moon phases (New, First Quarter, Full, Last Quarter): the instants when the Moon's
 * geocentric ecliptic longitude leads the Sun's by 0°, 90°, 180° and 270°. Found by scanning the
 * elongation from the same Meeus series the positions use (ch. 47 Moon, ch. 25 Sun) and
 * bisecting each crossing, rather than the mean-phase polynomials of ch. 49, so the phase
 * calendar and the phase name shown for any instant can never disagree.
 */
import { lunarEquatorial } from './lunar.ts';
import { solarEquatorial } from './solar.ts';
import { julianCenturiesTT } from './time.ts';

export type PrincipalPhase = 'new' | 'first-quarter' | 'full' | 'last-quarter';

export interface MoonPhaseEvent {
  phase: PrincipalPhase;
  /** UTC instant. */
  at: Date;
}

const PHASE_ANGLES: ReadonlyArray<[number, PrincipalPhase]> = [
  [0, 'new'],
  [90, 'first-quarter'],
  [180, 'full'],
  [270, 'last-quarter'],
];

/** Elongation of the Moon from the Sun in ecliptic longitude, degrees [0, 360). */
export function moonElongationDeg(date: Date): number {
  const T = julianCenturiesTT(date);
  const d = lunarEquatorial(T).eclipticLongitudeDeg - solarEquatorial(T).eclipticLongitudeDeg;
  return ((d % 360) + 360) % 360;
}

/** Signed distance (degrees, −180…180) of the elongation at `t` ahead of `target`. */
function ahead(t: number, target: number): number {
  const d = (((moonElongationDeg(new Date(t)) - target) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/**
 * The next `count` principal phases after `from`, in order. The elongation grows ~12.2°/day, so
 * a 6-hour scan cannot miss a crossing; each is then bisected to the second.
 */
export function nextMoonPhases(from: Date, count = 4): MoonPhaseEvent[] {
  const out: MoonPhaseEvent[] = [];
  const STEP = 6 * 3_600_000;
  // Crossings within a step are found per target angle; the step is tiny next to a phase's
  // ~7.4-day spacing, so at most one phase falls in any step.
  let t = from.getTime();
  const limit = from.getTime() + (count + 1) * 8 * 86_400_000;
  while (out.length < count && t < limit) {
    const next = t + STEP;
    for (const [angle, phase] of PHASE_ANGLES) {
      const a = ahead(t, angle);
      const b = ahead(next, angle);
      // Crossed the target going forward: behind before, ahead (or exactly on) after.
      if (a < 0 && b >= 0) {
        let lo = t;
        let hi = next;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (ahead(mid, angle) < 0) lo = mid;
          else hi = mid;
        }
        out.push({ phase, at: new Date(Math.round(hi / 1000) * 1000) });
      }
    }
    t = next;
  }
  out.sort((x, y) => x.at.getTime() - y.at.getTime());
  return out.slice(0, count);
}

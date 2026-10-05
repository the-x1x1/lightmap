/**
 * Principal moon phases (New, First Quarter, Full, Last Quarter): the instants when the Moon's
 * geocentric ecliptic longitude leads the Sun's by 0°, 90°, 180° and 270°. Found by scanning the
 * elongation from the same Meeus series the positions use (ch. 47 Moon, ch. 25 Sun) and
 * bisecting each crossing, rather than the mean-phase polynomials of ch. 49, so the phase
 * calendar and the phase name shown for any instant agree.
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

/** Signed distance (degrees, −180…180) of an elongation ahead of `target`. */
function aheadOf(elongationDeg: number, target: number): number {
  const d = (((elongationDeg - target) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/**
 * The next `count` principal phases strictly after `from`, in order (a phase falling exactly on
 * `from` is not listed). The elongation grows 0.45–0.6°/h and never runs backward, so a 6-hour
 * scan cannot miss a crossing; each is then bisected and reported as the first whole second at
 * or after the crossing, so `moonPosition(at)` names that phase.
 */
export function nextMoonPhases(from: Date, count = 4): MoonPhaseEvent[] {
  const out: MoonPhaseEvent[] = [];
  const STEP = 6 * 3_600_000;
  let t = from.getTime();
  let e = moonElongationDeg(new Date(t));
  const limit = from.getTime() + (count + 1) * 8 * 86_400_000;
  while (out.length < count && t < limit) {
    const next = t + STEP;
    const eNext = moonElongationDeg(new Date(next));
    for (const [angle, phase] of PHASE_ANGLES) {
      // Crossed the target going forward: behind before, ahead (or exactly on) after. The step
      // is tiny next to a phase's ~7.4-day spacing, so at most one phase falls in any step.
      if (aheadOf(e, angle) < 0 && aheadOf(eNext, angle) >= 0) {
        let lo = t;
        let hi = next;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (aheadOf(moonElongationDeg(new Date(mid)), angle) < 0) lo = mid;
          else hi = mid;
        }
        out.push({ phase, at: new Date(Math.ceil(hi / 1000) * 1000) });
      }
    }
    t = next;
    e = eNext;
  }
  out.sort((x, y) => x.at.getTime() - y.at.getTime());
  return out.slice(0, count);
}

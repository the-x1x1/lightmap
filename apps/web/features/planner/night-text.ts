/**
 * Night-planning read-outs for the Sun & moon details (pure, unit-tested): the Milky Way core
 * line and the phase calendar.
 */
import {
  nextMoonPhases,
  utcToWallClock,
  type MilkyWayCoreState,
  type PrincipalPhase,
} from '@lightmap/astronomy';
import { compassLabel } from '@lightmap/geospatial';

/** How far ahead the dark-window scan looks: a lunation and a half, so a Moon-free run is always inside it. */
export const DARK_WINDOW_NIGHTS = 45;

const PHASE_LABEL: Record<PrincipalPhase, string> = {
  new: 'New',
  'first-quarter': 'First quarter',
  full: 'Full',
  'last-quarter': 'Last quarter',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "36° up SSW — Astronomical night, core 36° up, Moon down" / "below the horizon — …". */
export function describeMilkyWay(n: MilkyWayCoreState): string {
  const where =
    n.elevationDeg > 0
      ? `${Math.round(n.elevationDeg)}° up ${compassLabel(n.azimuthDeg)}`
      : 'below the horizon';
  return `${where} — ${n.reason}`;
}

/** "Full 31 May · Last quarter 8 Jun · New 15 Jun · First quarter 21 Jun" in the planning zone. */
export function describeNextPhases(from: Date, timeZone: string): string {
  return nextMoonPhases(from, 4)
    .map((e) => {
      const w = utcToWallClock(e.at, timeZone);
      return `${PHASE_LABEL[e.phase]} ${w.day} ${MONTHS[w.month - 1] ?? ''}`;
    })
    .join(' · ');
}

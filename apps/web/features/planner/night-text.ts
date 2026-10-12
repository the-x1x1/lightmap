/**
 * Night-planning read-outs for the Sun & moon details (pure, unit-tested): the Milky Way core
 * line, the phase calendar, and the apparent sizes — how wide the Sun or Moon is, how much of
 * the frame that is, and which full Moons ahead are the big ones.
 */
import {
  nextMoonPhases,
  utcToWallClock,
  type FullMoonSize,
  type MilkyWayCoreState,
  type PrincipalPhase,
} from '@lightmap/astronomy';
import { compassLabel } from '@lightmap/geospatial';
import { discFrameShare } from '@lightmap/scene';

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

/**
 * "0.53°" with, when the camera frames a shot, the share of the frame width the disc covers:
 * "0.53° · 10 % of frame" (400 mm) / "0.53° · 0.6 % of frame" (24 mm). One decimal below 1 %,
 * whole percent above, so a long lens's figure reads at a glance.
 */
export function describeDisc(diameterDeg: number, fovDeg: number | null): string {
  const base = `${diameterDeg.toFixed(2)}°`;
  if (fovDeg === null || !(fovDeg > 0)) return base;
  const share = discFrameShare(diameterDeg, fovDeg) * 100;
  const pct = share >= 1 ? `${Math.round(share)}` : share.toFixed(1);
  return `${base} · ${pct} % of frame`;
}

/** "6 % wider than average" / "5 % narrower than average" / "average size" (whole percent). */
export function describeMoonSize(sizeVsMean: number): string {
  const pct = Math.round(Math.abs(sizeVsMean) * 100);
  if (pct === 0) return 'average size';
  return `${pct} % ${sizeVsMean > 0 ? 'wider' : 'narrower'} than average`;
}

/** "24 Dec (+8 %)" — a full Moon's date in the planning zone with its size against the mean. */
export function formatFullMoon(m: FullMoonSize, timeZone: string): string {
  const w = utcToWallClock(m.at, timeZone);
  const pct = Math.round(m.sizeVsMean * 100);
  return `${w.day} ${MONTHS[w.month - 1] ?? ''} (${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)} %)`;
}

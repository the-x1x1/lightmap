/**
 * Night-planning read-outs for the Sun & moon details (pure, unit-tested): the Milky Way core
 * line, the phase calendar, and the apparent sizes — how wide the Sun or Moon is, how much of
 * the frame that is, which full Moons ahead are the big ones, and the eclipses ahead as seen
 * from here.
 */
import {
  formatWallTime,
  nextMoonPhases,
  utcToWallClock,
  type EclipseHere,
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

/** "20:28:27"-style wall time with seconds, for the contacts of a central eclipse. */
function wallTimeWithSeconds(at: Date, timeZone: string): string {
  const w = utcToWallClock(at, timeZone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(w.hour)}:${two(w.minute)}:${two(w.second)}`;
}

/** "1 min 37 s" / "6 min 25 s" / "48 s". */
export function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m} min ${r} s` : `${r} s`;
}

export interface EclipseLine {
  /** "Total lunar eclipse" / "Partial solar eclipse here". */
  title: string;
  /** "3 Mar" in the planning zone. */
  date: string;
  /** What this place sees, with local times. */
  detail: string;
  /** The instant to jump the planner to: greatest eclipse. */
  at: Date;
}

/**
 * One eclipse as a line for the Moon details, from the observer's point of view: the type, the
 * date, greatest eclipse and the contacts that matter here, in the planning zone. A solar
 * eclipse is always "here" (it exists only for a place); a lunar one says whether the Moon is
 * up for it.
 */
export function describeEclipse(e: EclipseHere, timeZone: string): EclipseLine {
  const w = utcToWallClock(e.greatest, timeZone);
  const date = `${w.day} ${MONTHS[w.month - 1] ?? ''}`;
  const t = (d: Date) => formatWallTime(d, timeZone);
  if (e.kind === 'lunar') {
    const type = e.type === 'total' ? 'Total' : e.type === 'partial' ? 'Partial' : 'Penumbral';
    const parts: string[] = [`greatest ${t(e.greatest)}`];
    if (e.contacts.umbralStart && e.contacts.umbralEnd)
      parts.push(`in the umbra ${t(e.contacts.umbralStart)}–${t(e.contacts.umbralEnd)}`);
    if (e.contacts.totalStart && e.contacts.totalEnd)
      parts.push(`total ${t(e.contacts.totalStart)}–${t(e.contacts.totalEnd)}`);
    if (e.type === 'penumbral')
      parts.push(
        `${t(e.contacts.penumbralStart)}–${t(e.contacts.penumbralEnd)}, a faint shading only`,
      );
    const up = e.moonUp;
    const here =
      !up.start && !up.greatest && !up.end
        ? 'the Moon is below the horizon here'
        : up.start && up.greatest && up.end
          ? `the Moon up throughout from here, ${Math.round(e.moonAtGreatest.elevationDeg)}° ${compassLabel(e.moonAtGreatest.azimuthDeg)} at greatest`
          : !up.start && up.end
            ? `the Moon rises here during it${up.greatest ? '' : ', after greatest eclipse'}`
            : up.start && !up.end
              ? `the Moon sets here during it${up.greatest ? '' : ', before greatest eclipse'}`
              : 'the Moon is up here for only part of it';
    return {
      title: `${type} lunar eclipse`,
      date,
      detail: `${parts.join(', ')} — ${here}`,
      at: e.greatest,
    };
  }
  const type = e.type === 'total' ? 'Total' : e.type === 'annular' ? 'Annular' : 'Partial';
  const el = Math.round(e.sunAtGreatest.elevationDeg);
  const sun =
    el <= 0
      ? `Sun on the horizon ${compassLabel(e.sunAtGreatest.azimuthDeg)}`
      : `Sun ${el}° up ${compassLabel(e.sunAtGreatest.azimuthDeg)}`;
  const parts: string[] = [];
  if (e.type !== 'partial' && e.centralStart && e.centralEnd) {
    const secs = (e.centralEnd.getTime() - e.centralStart.getTime()) / 1000;
    parts.push(
      `${e.type === 'total' ? 'totality' : 'annularity'} ${wallTimeWithSeconds(e.centralStart, timeZone)}–${wallTimeWithSeconds(e.centralEnd, timeZone)} (${formatSeconds(secs)})`,
    );
  } else {
    parts.push(`greatest ${t(e.greatest)}`);
    parts.push(
      `${Math.round(e.magnitude * 100)} % of the Sun’s width covered (${Math.round(e.obscuration * 100)} % of the disc)`,
    );
  }
  parts.push(`${t(e.start)}–${t(e.end)}`);
  parts.push(sun);
  const clipped =
    e.clipped.start && e.clipped.end
      ? '; the Sun is up for only part of it'
      : e.clipped.start
        ? '; it begins before sunrise'
        : e.clipped.end
          ? '; the Sun sets before it ends'
          : '';
  return {
    title: `${type} solar eclipse here`,
    date,
    detail: `${parts.join(', ')}${clipped}`,
    at: e.greatest,
  };
}

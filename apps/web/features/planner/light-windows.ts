/**
 * The photographer's windows of the civil day with their lengths (pure, unit-tested) — golden
 * hour (Sun −4°…+6°) and blue hour (−6°…−4°), the bands `@lightmap/astronomy` defines:
 * "Golden hour 05:33–06:20 (47 min) · 18:37–19:24 (47 min); blue hour 05:23–05:33 (10 min) ·
 * 19:24–19:33 (9 min)". The day is sampled every five minutes so a window that straddles
 * midnight (the midnight-sun golden light) or never crosses an edge inside the day is still
 * listed, clamped to the day's bounds ("00:00" / "24:00"); edges snap to the exact crossing
 * instants the day events already hold. Nothing at all gives null.
 */
import { THRESHOLDS, formatWallTime, sunPosition, type DayEvents } from '@lightmap/astronomy';

export interface LightWindow {
  start: Date;
  end: Date;
  minutes: number;
}

export interface LightWindows {
  golden: LightWindow[];
  blue: LightWindow[];
}

const STEP_MS = 5 * 60_000;
const SNAP_MS = 6 * 60_000;

/** The known crossing instant nearest to `t` (within the sampling step), else `t` itself. */
function snap(t: number, crossings: readonly (Date | null)[]): number {
  let best = t;
  let d = SNAP_MS;
  for (const c of crossings) {
    if (!c) continue;
    const dd = Math.abs(c.getTime() - t);
    if (dd < d) {
      d = dd;
      best = c.getTime();
    }
  }
  return best;
}

function windows(
  ev: Pick<DayEvents, 'dayStart' | 'dayEnd'>,
  point: { latitude: number; longitude: number },
  inBand: (elevationDeg: number) => boolean,
  crossings: readonly (Date | null)[],
): LightWindow[] {
  const start = ev.dayStart.getTime();
  const end = ev.dayEnd.getTime();
  const out: LightWindow[] = [];
  let open: number | null = null;
  let prev = start;
  for (let t = start; t <= end; t += STEP_MS) {
    const inside = inBand(sunPosition(new Date(t), point.latitude, point.longitude).elevationDeg);
    if (inside && open === null) open = t === start ? start : snap(t, crossings);
    else if (!inside && open !== null) {
      const close = snap(t, crossings);
      if (close > open) out.push({ start: new Date(open), end: new Date(close), minutes: 0 });
      open = null;
    }
    prev = t;
  }
  if (open !== null && prev > open)
    out.push({ start: new Date(open), end: new Date(end), minutes: 0 });
  return out
    .map((w) => ({ ...w, minutes: Math.round((w.end.getTime() - w.start.getTime()) / 60_000) }))
    .filter((w) => w.minutes >= 1);
}

/** Golden and blue windows of the civil day at the place, clamped to the day. */
export function lightWindows(
  ev: Pick<
    DayEvents,
    | 'dayStart'
    | 'dayEnd'
    | 'dawn'
    | 'civilDusk'
    | 'goldenHourMorningStart'
    | 'goldenHourMorningEnd'
    | 'goldenHourEveningStart'
    | 'goldenHourEveningEnd'
  >,
  point: { latitude: number; longitude: number },
): LightWindows {
  const edges = [
    ev.dawn,
    ev.civilDusk,
    ev.goldenHourMorningStart,
    ev.goldenHourMorningEnd,
    ev.goldenHourEveningStart,
    ev.goldenHourEveningEnd,
  ];
  return {
    golden: windows(
      ev,
      point,
      (el) => el >= THRESHOLDS.goldenLow && el < THRESHOLDS.goldenHigh,
      edges,
    ),
    blue: windows(ev, point, (el) => el >= THRESHOLDS.civil && el < THRESHOLDS.goldenLow, edges),
  };
}

function clock(d: Date, ev: Pick<DayEvents, 'dayEnd'>, tz: string): string {
  return d.getTime() === ev.dayEnd.getTime() ? '24:00' : formatWallTime(d, tz);
}

/** One line for the details panel, or null when the day has neither window. */
export function describeLightWindows(
  ev: Parameters<typeof lightWindows>[0],
  point: { latitude: number; longitude: number },
  tz: string,
): string | null {
  const w = lightWindows(ev, point);
  const fmt = (x: LightWindow) =>
    `${clock(x.start, ev, tz)}–${clock(x.end, ev, tz)} (${x.minutes} min)`;
  const parts: string[] = [];
  if (w.golden.length) parts.push(`Golden hour ${w.golden.map(fmt).join(' · ')}`);
  if (w.blue.length) parts.push(`blue hour ${w.blue.map(fmt).join(' · ')}`);
  return parts.length ? parts.join('; ') : null;
}

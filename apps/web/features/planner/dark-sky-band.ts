/**
 * Timeline track band for the spells of the civil day when the Milky Way core can be shot
 * (night planning): a faint violet layer over the night portions of the track, like the terrain
 * shade darkens daylight behind a ridge. Pure; unit-tested.
 */
import { milkyWayWindows, type DayEvents } from '@lightmap/astronomy';

export interface Spell {
  from: Date;
  to: Date;
}

/**
 * The dark-sky spells of one civil day, clipped to it. The scan runs over the padded night (noon
 * before to noon after) with the same 30-minute rule as the "dark windows ahead" list, so a
 * window that straddles local midnight keeps both its pieces and a run too short for the list
 * never shows on the track.
 */
export function darkSkySpells(
  ev: Pick<DayEvents, 'dayStart' | 'dayEnd'>,
  latitude: number,
  longitude: number,
): Spell[] {
  const HALF_DAY = 12 * 3_600_000;
  const start = ev.dayStart.getTime();
  const end = ev.dayEnd.getTime();
  const from = new Date(start - HALF_DAY);
  const days = (end + HALF_DAY - from.getTime()) / 86_400_000;
  return milkyWayWindows(from, days, latitude, longitude)
    .windows.map((w) => ({
      from: new Date(Math.max(w.start.getTime(), start)),
      to: new Date(Math.min(w.end.getTime(), end)),
    }))
    .filter((s) => s.to.getTime() > s.from.getTime());
}

/** A gradient layer marking the spells on the track; null when there are none. */
export function darkSkyBand(
  ev: Pick<DayEvents, 'dayStart' | 'dayEnd'>,
  spells: Spell[],
): string | null {
  if (spells.length === 0) return null;
  const total = ev.dayEnd.getTime() - ev.dayStart.getTime();
  const pct = (d: Date) => `${(((d.getTime() - ev.dayStart.getTime()) / total) * 100).toFixed(2)}%`;
  const on = 'rgba(201,184,255,0.45)';
  const off = 'rgba(201,184,255,0)';
  const stops: string[] = [`${off} 0%`];
  for (const s of spells)
    stops.push(
      `${off} ${pct(s.from)}`,
      `${on} ${pct(s.from)}`,
      `${on} ${pct(s.to)}`,
      `${off} ${pct(s.to)}`,
    );
  stops.push(`${off} 100%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

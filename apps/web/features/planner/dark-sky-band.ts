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

/** The dark-sky spells of one civil day (clipped to it), from the night-sky scan. */
export function darkSkySpells(
  ev: Pick<DayEvents, 'dayStart' | 'dayEnd'>,
  latitude: number,
  longitude: number,
): Spell[] {
  const days = (ev.dayEnd.getTime() - ev.dayStart.getTime()) / 86_400_000;
  return milkyWayWindows(ev.dayStart, days, latitude, longitude, { minMinutes: 20 }).windows.map(
    (w) => ({ from: w.start, to: w.end }),
  );
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

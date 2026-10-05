/**
 * The photographer's windows of the day as one line with their lengths (pure, unit-tested):
 * "Golden hour 05:48–06:36 (48 min) · 18:21–19:09 (48 min); blue hour 05:23–05:48 (25 min) ·
 * 19:09–19:33 (24 min)". A window that does not occur (polar day, or a sun that never reaches
 * the band) is left out; nothing at all gives null.
 */
import { formatWallTime, type DayEvents } from '@lightmap/astronomy';

function span(from: Date | null, to: Date | null, tz: string): string | null {
  if (!from || !to || to.getTime() <= from.getTime()) return null;
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  return `${formatWallTime(from, tz)}–${formatWallTime(to, tz)} (${minutes} min)`;
}

export function describeLightWindows(ev: DayEvents, tz: string): string | null {
  const golden = [
    span(ev.goldenHourMorningStart, ev.goldenHourMorningEnd, tz),
    span(ev.goldenHourEveningStart, ev.goldenHourEveningEnd, tz),
  ].filter((s): s is string => s !== null);
  const blue = [span(ev.dawn, ev.sunrise, tz), span(ev.sunset, ev.civilDusk, tz)].filter(
    (s): s is string => s !== null,
  );
  const parts: string[] = [];
  if (golden.length) parts.push(`Golden hour ${golden.join(' · ')}`);
  if (blue.length) parts.push(`blue hour ${blue.join(' · ')}`);
  return parts.length ? parts.join('; ') : null;
}

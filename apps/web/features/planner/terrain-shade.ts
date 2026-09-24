/**
 * Timeline track shading for spells when the sun is behind the terrain (pure; unit-tested).
 */
import type { DayEvents } from '@lightmap/astronomy';

function minutesOf(d: Date, dayStart: Date): number {
  return (d.getTime() - dayStart.getTime()) / 60_000;
}

/**
 * A second gradient layer that darkens the daylight portions of the track where the sun is behind
 * the terrain: transparent over each visible spell and over the night, dark elsewhere between
 * sunrise and sunset. Returns null when there is nothing to shade.
 */
export function terrainShade(
  ev: DayEvents,
  visible: ReadonlyArray<{ from: Date; to: Date }>,
): string | null {
  if (!ev.sunrise || !ev.sunset) return null;
  const total = (ev.dayEnd.getTime() - ev.dayStart.getTime()) / 60_000;
  const pct = (d: Date) => `${((minutesOf(d, ev.dayStart) / total) * 100).toFixed(2)}%`;
  const dark = 'rgba(8,10,20,0.55)';
  const clear = 'rgba(8,10,20,0)';
  // Shaded intervals = [sunrise, sunset] minus the visible spells.
  const gaps: Array<[Date, Date]> = [];
  let cursor = ev.sunrise;
  for (const v of visible) {
    if (v.from > cursor) gaps.push([cursor, v.from]);
    if (v.to > cursor) cursor = v.to;
  }
  if (cursor < ev.sunset) gaps.push([cursor, ev.sunset]);
  const shaded = gaps.filter(([a, b]) => b.getTime() - a.getTime() > 60_000);
  if (shaded.length === 0) return null;
  const stops: string[] = [`${clear} 0%`];
  for (const [a, b] of shaded)
    stops.push(
      `${clear} ${pct(a)}`,
      `${dark} ${pct(a)}`,
      `${dark} ${pct(b)}`,
      `${clear} ${pct(b)}`,
    );
  stops.push(`${clear} 100%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * The light finder's results as plain text for the clipboard — one line per moment, in the
 * planning zone, with the bearing, height, trend and the Moon's lit share and disc when it is
 * the Moon — so a search can go into notes or a message. Pure, unit-tested.
 */
import { formatWallTime } from '@lightmap/astronomy';
import { compassLabel } from '@lightmap/geospatial';
import type { SerializedMatch } from './solver-types';

export function finderResultsText(
  matches: readonly SerializedMatch[],
  opts: { timeZone: string; body: 'sun' | 'moon' | 'core'; place: string },
): string {
  const name = opts.body === 'sun' ? 'Sun' : opts.body === 'moon' ? 'Moon' : 'Milky Way core';
  const lines = [
    `${name} at ${opts.place} — ${matches.length} ${matches.length === 1 ? 'moment' : 'moments'} (times ${opts.timeZone})`,
    ...matches.map((m) => {
      const at = new Date(m.timestampUtc);
      const extra = [
        m.illuminatedFraction !== null ? `${Math.round(m.illuminatedFraction * 100)} % lit` : null,
        m.body === 'moon' && m.apparentDiameterDegrees !== null
          ? `${m.apparentDiameterDegrees.toFixed(2)}°`
          : null,
        m.sky !== null && m.sky !== 'dark' ? m.sky : null,
      ].filter((x): x is string => x !== null);
      return `${m.date} ${formatWallTime(at, opts.timeZone)}  ${Math.round(m.azimuthDegrees)}° ${compassLabel(m.azimuthDegrees)}, ${m.elevationDegrees.toFixed(1)}° ${m.trend}${extra.length ? ` · ${extra.join(', ')}` : ''}`;
    }),
    'Geometry only: terrain, clouds and refraction near the horizon are not in the search.',
  ];
  return lines.join('\n');
}

/**
 * Light finder results as an iCalendar file: one event per moment — "every date the sun sets
 * behind that ridge" straight into the calendar — from half an hour before the instant to a
 * quarter after, with the bearing, height and (for the Moon) the lit share and disc in the
 * description, a reminder an hour before, and a UID from the place cell and the instant so
 * re-importing updates. Pure, unit-tested.
 */
import { brand } from '@lightmap/config';
import { formatWallTime } from '@lightmap/astronomy';
import { compassLabel, gridKey } from '@lightmap/geospatial';
import type { SerializedMatch } from '@/features/finder/solver-types';
import {
  AFTER_MINUTES,
  REMINDER_MINUTES,
  SETUP_MINUTES,
  foldLine,
  icsText,
  icsUtc,
} from './calendar';

export function buildFinderCalendar(
  matches: readonly SerializedMatch[],
  place: { label: string; latitude: number; longitude: number; timeZone: string },
  opts: { body: 'sun' | 'moon' | 'core'; generatedAt: Date },
): string {
  const name = opts.body === 'sun' ? 'Sun' : opts.body === 'moon' ? 'Moon' : 'Milky Way core';
  // A comma-free cell: a UID is a text value and the RFC wants commas escaped.
  const cell = gridKey({ latitude: place.latitude, longitude: place.longitude }).replace(',', '_');
  const events = matches.flatMap((m) => {
    const at = new Date(m.timestampUtc);
    const start = new Date(at.getTime() - SETUP_MINUTES * 60_000);
    const end = new Date(at.getTime() + AFTER_MINUTES * 60_000);
    const extra = [
      m.illuminatedFraction !== null ? `${Math.round(m.illuminatedFraction * 100)} % lit` : null,
      m.body === 'moon' && m.apparentDiameterDegrees !== null
        ? `${m.apparentDiameterDegrees.toFixed(2)}° across`
        : null,
      m.sky !== null && m.sky !== 'dark' ? `sky: ${m.sky}` : null,
    ].filter((x): x is string => x !== null);
    return [
      'BEGIN:VEVENT',
      `UID:finder-${cell}-${opts.body}-${icsUtc(at)}@${brand.slug}`,
      `DTSTAMP:${icsUtc(opts.generatedAt)}`,
      `DTSTART:${icsUtc(start)}`,
      `DTEND:${icsUtc(end)}`,
      `SUMMARY:${icsText(`${name} ${Math.round(m.azimuthDegrees)}° ${compassLabel(m.azimuthDegrees)} · ${place.label}`)}`,
      `LOCATION:${icsText(`${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`)}`,
      `GEO:${place.latitude.toFixed(6)};${place.longitude.toFixed(6)}`,
      `DESCRIPTION:${icsText(
        [
          `${name} at ${formatWallTime(at, place.timeZone)} (${place.timeZone}): ${Math.round(m.azimuthDegrees)}° ${compassLabel(m.azimuthDegrees)}, ${m.elevationDegrees.toFixed(1)}° ${m.trend}${extra.length ? ` · ${extra.join(', ')}` : ''}.`,
          `Planned instant: ${SETUP_MINUTES} min after the event starts.`,
          'Geometry only: terrain, clouds and refraction near the horizon are not in the search.',
        ].join('\n'),
      )}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(`${name} alignment in ${REMINDER_MINUTES} min`)}`,
      `TRIGGER:-PT${REMINDER_MINUTES - SETUP_MINUTES}M`,
      'END:VALARM',
      'END:VEVENT',
    ];
  });
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${brand.name}//Light finder//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(`${name} · ${place.label}`)}`,
    ...events,
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

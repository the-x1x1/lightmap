/**
 * The dark windows ahead as an iCalendar file: one event per night the Milky Way core can be
 * shot from the place (the same windows the Moon details list), from the window's start to its
 * end with the core's peak in the description and a reminder an hour before. UIDs are the
 * place cell and the window's start, so importing again updates rather than duplicates. Pure.
 */
import { brand } from '@lightmap/config';
import { formatWallTime, type MilkyWayWindow } from '@lightmap/astronomy';
import { gridKey } from '@lightmap/geospatial';
import { REMINDER_MINUTES, foldLine, icsText, icsUtc } from './calendar';

export function buildDarkWindowsCalendar(
  windows: readonly MilkyWayWindow[],
  place: { label: string; latitude: number; longitude: number; timeZone: string },
  opts: { generatedAt: Date },
): string {
  // A comma-free cell: a UID is a text value and the RFC wants commas escaped.
  const cell = gridKey({ latitude: place.latitude, longitude: place.longitude }).replace(',', '_');
  const events = windows.flatMap((w) => [
    'BEGIN:VEVENT',
    `UID:dark-${cell}-${icsUtc(w.start)}@${brand.slug}`,
    `DTSTAMP:${icsUtc(opts.generatedAt)}`,
    `DTSTART:${icsUtc(w.start)}`,
    `DTEND:${icsUtc(w.end)}`,
    `SUMMARY:${icsText(`Milky Way core · ${place.label}`)}`,
    `LOCATION:${icsText(`${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`)}`,
    `GEO:${place.latitude.toFixed(6)};${place.longitude.toFixed(6)}`,
    `DESCRIPTION:${icsText(
      [
        `Dark sky with the Galactic Centre up: ${formatWallTime(w.start, place.timeZone)}–${formatWallTime(w.end, place.timeZone)} (${place.timeZone}).`,
        `Core highest at ${formatWallTime(w.peakAt, place.timeZone)}, ${Math.round(w.peakElevationDeg)}° up.`,
        w.withThinMoon ? 'A thin Moon is up for part of it.' : 'No Moon.',
        'Geometry only — no sky-brightness or light-pollution model; check the forecast.',
      ].join('\n'),
    )}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(`Milky Way window in ${REMINDER_MINUTES} min`)}`,
    `TRIGGER:-PT${REMINDER_MINUTES}M`,
    'END:VALARM',
    'END:VEVENT',
  ]);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${brand.name}//Dark windows//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(`Milky Way · ${place.label}`)}`,
    ...events,
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * A project's shots as an iCalendar file (RFC 5545) for any calendar app: one event per saved
 * viewpoint, from half an hour before the planned instant (time to be set up) to a quarter of an
 * hour after, with a reminder an hour before, the place as LOCATION and GEO, the shot-list block
 * (camera, sun, Moon and Milky Way core at night, the weather basis) as the description and the
 * link that reopens the viewpoint. Each event's UID is the viewpoint's own id, so importing the
 * file again updates the events instead of duplicating them. Instants are written in UTC: every
 * calendar shows them in its own zone. Pure, unit-tested.
 */
import { brand } from '@lightmap/config';
import type { DistanceUnits } from '@lightmap/scene';
import type { ProjectDto, ViewpointDto } from '@/lib/api-types';
import { viewpointUrl } from '@/features/projects/open-viewpoint';
import { shotBlock } from './shot-list';

export interface CalendarOptions {
  appUrl: string;
  generatedAt: Date;
  units?: DistanceUnits;
}

/** Minutes before the planned instant the event starts, and after it that it ends. */
export const SETUP_MINUTES = 30;
export const AFTER_MINUTES = 15;
/** Reminder before the event starts. */
export const REMINDER_MINUTES = 60;

/** 20261011T043000Z */
export function icsUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Text value escaping (RFC 5545 §3.3.11): backslash, semicolon, comma and newlines. */
export function icsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Content lines fold at 75 octets (RFC 5545 §3.1): continuation lines start with one space. Folds
 * fall between UTF-8 sequences, never inside a character.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // the leading space counts on continuation lines
    if (bytes + n > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function eventLines(project: ProjectDto, v: ViewpointDto, opts: CalendarOptions): string[] {
  const at = new Date(v.selectedDatetimeUtc);
  const start = new Date(at.getTime() - SETUP_MINUTES * 60_000);
  const end = new Date(at.getTime() + AFTER_MINUTES * 60_000);
  const url = viewpointUrl(opts.appUrl, v.id);
  const description = [
    ...shotBlock(v, undefined, opts.units ?? 'metric').map((l) => l.trim()),
    `Planned instant: ${SETUP_MINUTES} min after the event starts.`,
    `Open in ${brand.name}: ${url}`,
  ].join('\n');
  return [
    'BEGIN:VEVENT',
    `UID:${v.id}@${brand.slug}`,
    `DTSTAMP:${icsUtc(opts.generatedAt)}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsText(`${v.label} · ${project.name}`)}`,
    `LOCATION:${icsText(`${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}`)}`,
    `GEO:${v.latitude.toFixed(6)};${v.longitude.toFixed(6)}`,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(`${v.label} in ${REMINDER_MINUTES} min`)}`,
    `TRIGGER:-PT${REMINDER_MINUTES}M`,
    'END:VALARM',
    'END:VEVENT',
  ];
}

/** The whole project as a VCALENDAR, events in time order; CRLF line endings as the RFC asks. */
export function buildCalendar(
  project: ProjectDto,
  viewpoints: readonly ViewpointDto[],
  opts: CalendarOptions,
): string {
  const byTime = [...viewpoints].sort(
    (a, b) => Date.parse(a.selectedDatetimeUtc) - Date.parse(b.selectedDatetimeUtc),
  );
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${brand.name}//Shot calendar//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(project.name)}`,
    ...byTime.flatMap((v) => eventLines(project, v, opts)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

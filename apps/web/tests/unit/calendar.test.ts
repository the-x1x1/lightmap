import { describe, expect, it } from 'vitest';
import { buildCalendar, foldLine, icsText, icsUtc } from '../../features/export/calendar.ts';
import type { ProjectDto, ViewpointDto } from '../../lib/api-types.ts';

const project: ProjectDto = {
  id: 'p1',
  name: 'Kailua weekend, dawn; dusk',
  description: null,
  shootDate: '2026-06-15',
  archivedAt: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
  viewpointCount: 2,
  upcomingViewpointCount: 0,
};

const base: ViewpointDto = {
  id: 'v1',
  projectId: 'p1',
  label: 'Beach, noon',
  latitude: 21.397,
  longitude: -157.727,
  elevationM: 3,
  timezone: 'Pacific/Honolulu',
  headingDeg: 270,
  pitchDeg: 5,
  fieldOfViewDeg: 60,
  focalLengthEquivalentMm: 24,
  selectedDatetimeUtc: '2026-05-31T22:30:00Z',
  weatherMode: 'SCENARIO',
  weatherScenario: 'overcast',
  previewSourceType: 'ESTIMATED_PREVIEW',
  parentViewpointId: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

const opts = { appUrl: 'https://lightmap.example', generatedAt: new Date('2026-05-20T08:00:00Z') };

/** Unfold RFC 5545 continuation lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('calendar export (.ics)', () => {
  it('formats UTC instants and escapes text the RFC way', () => {
    expect(icsUtc(new Date('2026-05-31T22:30:00.000Z'))).toBe('20260531T223000Z');
    expect(icsText('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne');
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const line = `DESCRIPTION:${'é'.repeat(60)}`;
    const folded = foldLine(line);
    const enc = new TextEncoder();
    for (const part of folded.split('\r\n'))
      expect(enc.encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
    expect(foldLine('SHORT:x')).toBe('SHORT:x');
  });

  it('one event per viewpoint, in time order, from 30 min before to 15 min after, with a reminder', () => {
    const early: ViewpointDto = {
      ...base,
      id: 'v0',
      label: 'Dawn',
      selectedDatetimeUtc: '2026-05-31T15:30:00Z',
    };
    const ics = buildCalendar(project, [base, early], opts);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.includes('\n') && !/[^\r]\n/.test(ics)).toBe(true); // CRLF only
    const flat = unfold(ics);
    expect(flat.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(flat.indexOf('UID:v0@')).toBeLessThan(flat.indexOf('UID:v1@'));
    expect(flat).toContain('X-WR-CALNAME:Kailua weekend\\, dawn\\; dusk');
    expect(flat).toContain('DTSTART:20260531T220000Z');
    expect(flat).toContain('DTEND:20260531T224500Z');
    expect(flat).toContain('DTSTAMP:20260520T080000Z');
    expect(flat).toContain('SUMMARY:Beach\\, noon · Kailua weekend\\, dawn\\; dusk');
    expect(flat).toContain('GEO:21.397000;-157.727000');
    expect(flat).toContain('URL:https://lightmap.example/?viewpoint=v1');
    // An hour before the planned instant: 30 min before the event's own start.
    expect(flat).toContain('TRIGGER:-PT30M');
    // The description is the shot-list block, newlines escaped.
    expect(flat).toContain('When:    2026-05-31 12:30 (Pacific/Honolulu)\\n');
    expect(flat).toContain('Weather: Scenario (not a forecast): overcast');
  });

  it('an empty project gives a calendar with no events (the UI offers the file only with viewpoints)', () => {
    const ics = buildCalendar(project, [], opts);
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });
});

import { describe, expect, it } from 'vitest';
import { milkyWayWindows } from '@lightmap/astronomy';
import { buildDarkWindowsCalendar } from '../../features/export/dark-windows-calendar.ts';

describe('buildDarkWindowsCalendar', () => {
  it('one event per window with a stable UID, the peak in the description and an hour’s reminder', () => {
    const r = milkyWayWindows(new Date('2026-06-12T22:00:00Z'), 5, 21.397, -157.727);
    expect(r.windows.length).toBeGreaterThan(0);
    const ics = buildDarkWindowsCalendar(
      r.windows,
      {
        label: 'Kailua Beach',
        latitude: 21.397,
        longitude: -157.727,
        timeZone: 'Pacific/Honolulu',
      },
      { generatedAt: new Date('2026-06-01T00:00:00Z') },
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(r.windows.length);
    const flat = ics.replace(/\r\n /g, '');
    expect(flat).toContain('SUMMARY:Milky Way core · Kailua Beach');
    expect(flat).toContain(
      `UID:dark-21.4000_-157.7500-${r.windows[0]!.start.toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z')}@`,
    );
    // The comma is escaped as the RFC asks.
    expect(flat).toMatch(/Core highest at \d\d:\d\d\\, \d+° up\./);
    expect(flat).toContain('TRIGGER:-PT60M');
    // Every line folds under the RFC's 75 octets.
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // No windows: a calendar with no events.
    expect(
      buildDarkWindowsCalendar(
        [],
        { label: 'x', latitude: 0, longitude: 0, timeZone: 'UTC' },
        { generatedAt: new Date() },
      ),
    ).not.toContain('VEVENT');
  });
});

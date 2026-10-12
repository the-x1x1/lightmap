import { describe, expect, it } from 'vitest';
import { buildFinderCalendar } from '../../features/export/finder-calendar.ts';
import type { SerializedMatch } from '../../features/finder/solver-types.ts';

const m: SerializedMatch = {
  date: '2026-05-31',
  via: 'azimuth',
  timestampUtc: '2026-06-01T05:09:00.000Z',
  body: 'moon',
  azimuthDegrees: 110.4,
  elevationDegrees: 2.3,
  elevationErrorDegrees: null,
  withinTolerance: true,
  illuminatedFraction: 0.97,
  apparentDiameterDegrees: 0.551,
  sky: null,
  trend: 'rising',
};
const place = {
  label: 'Kailua Beach',
  latitude: 21.397,
  longitude: -157.727,
  timeZone: 'Pacific/Honolulu',
};

describe('buildFinderCalendar', () => {
  it('one event per moment around the instant, with the geometry in the description', () => {
    const ics = buildFinderCalendar(
      [m, { ...m, timestampUtc: '2026-06-02T05:40:00.000Z' }],
      place,
      {
        body: 'moon',
        generatedAt: new Date('2026-05-30T00:00:00Z'),
      },
    );
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    const flat = ics.replace(/\r\n /g, '');
    expect(flat).toContain('UID:finder-21.4000,-157.7500-moon-20260601T050900Z@');
    expect(flat).toContain('DTSTART:20260601T043900Z');
    expect(flat).toContain('DTEND:20260601T052400Z');
    expect(flat).toContain('SUMMARY:Moon 110° ESE · Kailua Beach');
    expect(flat).toContain(
      'Moon at 19:09 (Pacific/Honolulu): 110° ESE\\, 2.3° rising · 97 % lit\\, 0.55° across.',
    );
    expect(flat).toContain('TRIGGER:-PT30M');
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(buildFinderCalendar([], place, { body: 'sun', generatedAt: new Date() })).not.toContain(
      'VEVENT',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { describeRecurrence, formatCivilDay } from '../../features/finder/recurrence-text.ts';

const match = (iso: string, date: string) => ({
  date,
  via: 'azimuth' as const,
  timestampUtc: iso,
  body: 'sun' as const,
  azimuthDegrees: 250,
  elevationDegrees: 10,
  elevationErrorDegrees: 0.1,
  withinTolerance: true,
  illuminatedFraction: null,
  trend: 'setting' as const,
});

describe('formatCivilDay', () => {
  it('omits the year inside the scene year and shows it otherwise', () => {
    // ICU versions differ on the comma and on "Sep"/"Sept": match the parts, not the punctuation.
    expect(formatCivilDay('2026-03-21', '2026-03-20', 'en-GB')).toMatch(/^Sat,? 21 Mar$/);
    expect(formatCivilDay('2027-09-09', '2026-03-20', 'en-GB')).toMatch(/^Thu,? 9 Sept? 2027$/);
  });
  it('is a calendar-day label: unaffected by the location zone, even at UTC+14', () => {
    // 2026-01-01 in Kiritimati — a zone-aware "noon UTC" formatter would print 2 Jan.
    expect(formatCivilDay('2026-01-01', '2026-01-01', 'en-GB')).toMatch(/^Thu,? 1 Jan$/);
  });
});

describe('describeRecurrence', () => {
  it('describes a short run with a return six months later, in the location wall clock', () => {
    const t = describeRecurrence(
      {
        runEnds: '2026-03-21',
        runClipped: false,
        next: match('2026-09-22T15:47:00Z', '2026-09-22'),
        daysUntilNext: 186,
      },
      'Europe/Paris',
      '2026-03-20',
      'en-GB',
    );
    expect(t.lasts).toMatch(/^Like this until Sat,? 21 Mar$/);
    expect(t.back).toMatch(/^Tue,? 22 Sept? \(in 186 days\)$/);
    expect(t.backTime).toBe('17:47');
  });
  it('says "last day" when tomorrow no longer matches and "tomorrow" for a one-day gap', () => {
    const t = describeRecurrence(
      {
        runEnds: null,
        runClipped: false,
        next: match('2026-03-22T14:00:00Z', '2026-03-22'),
        daysUntilNext: 1,
      },
      'UTC',
      '2026-03-21',
      'en-GB',
    );
    expect(t.lasts).toBe('Last day for this light');
    expect(t.back).toMatch(/^Sun,? 22 Mar \(tomorrow\)$/);
  });
  it('uses the civil date at the location, not the UTC date, for the return day', () => {
    // 2026-09-22 23:30 UTC is already 23 September in Tokyo.
    const t = describeRecurrence(
      {
        runEnds: '2026-03-21',
        runClipped: false,
        next: match('2026-09-22T23:30:00Z', '2026-09-23'),
        daysUntilNext: 187,
      },
      'Asia/Tokyo',
      '2026-03-20',
      'en-GB',
    );
    expect(t.back).toMatch(/^Wed,? 23 Sept? \(in 187 days\)$/);
    expect(t.backTime).toBe('08:30');
  });
  it('has no return text when nothing is in range', () => {
    const t = describeRecurrence(
      { runEnds: '2026-07-10', runClipped: false, next: null, daysUntilNext: null },
      'UTC',
      '2026-06-21',
    );
    expect(t.back).toBeNull();
    expect(t.backTime).toBeNull();
  });
  it('marks the run as a lower bound when the searched range ran out', () => {
    const t = describeRecurrence(
      { runEnds: '2026-07-05', runClipped: true, next: null, daysUntilNext: null },
      'UTC',
      '2026-06-21',
      'en-GB',
    );
    expect(t.lasts).toMatch(/^Like this until at least Sun,? 5 Jul$/);
  });
});

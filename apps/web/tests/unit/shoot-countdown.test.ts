import { describe, expect, it } from 'vitest';
import { OPEN_METEO_CAPABILITIES } from '@lightmap/weather';
import {
  civilDaysUntil,
  describeWhen,
  shootCountdown,
  shortCivilDate,
} from '@/features/projects/shoot-countdown';

const today = '2026-10-05';

describe('shoot countdown on project cards (plan §1 item 10)', () => {
  it('counts civil days, across month ends and leap days, and rejects malformed dates', () => {
    expect(civilDaysUntil('2026-10-17', today)).toBe(12);
    expect(civilDaysUntil('2026-11-01', '2026-10-31')).toBe(1);
    expect(civilDaysUntil('2028-03-01', '2028-02-28')).toBe(2);
    expect(civilDaysUntil('2026-10-05', today)).toBe(0);
    expect(civilDaysUntil('2026-10-02', today)).toBe(-3);
    expect(civilDaysUntil('17/10/2026', today)).toBeNull();
    expect(civilDaysUntil('2026-02-30', today)).toBeNull();
    expect(civilDaysUntil('2026-13-01', today)).toBeNull();
    expect(civilDaysUntil('2026-10-17', '')).toBeNull();
  });

  it('words the distance the way people say it', () => {
    expect(describeWhen(0)).toBe('today');
    expect(describeWhen(1)).toBe('tomorrow');
    expect(describeWhen(2)).toBe('in 2 days');
    expect(describeWhen(-1)).toBe('yesterday');
    expect(describeWhen(-3)).toBe('3 days ago');
    expect(shortCivilDate('2026-10-13', false, 'en-GB')).toBe('13 Oct');
    expect(shortCivilDate('2026-10-13', false, 'en-US')).toBe('Oct 13');
    expect(shortCivilDate('2026-09-01', false, 'en-GB')).toBe('1 Sep');
    expect(shortCivilDate('2027-09-01', true, 'en-GB')).toBe('1 Sep 2027');
    expect(shortCivilDate('nonsense')).toBe('nonsense');
  });

  it('says where the forecast stands for the date against the provider horizons (7 / 15 days)', () => {
    const c = (shootDate: string) =>
      shootCountdown(shootDate, today, OPEN_METEO_CAPABILITIES, 'en-GB');
    expect(c('2026-10-17')).toEqual({
      days: 12,
      when: 'in 12 days',
      forecast: { kind: 'extended' },
      text: 'in 12 days · extended forecast available',
    });
    // A day counts as inside a horizon only when its last hour is: 6 and 14 civil days ahead.
    expect(c('2026-10-11')?.text).toBe('in 6 days · forecast available');
    expect(c('2026-10-12')?.text).toBe('in 7 days · extended forecast available');
    expect(c('2026-10-19')?.text).toBe('in 14 days · extended forecast available');
    expect(c('2026-10-20')).toEqual({
      days: 15,
      when: 'in 15 days',
      forecast: { kind: 'ahead', opensOn: '2026-10-06', inDays: 1 },
      text: 'in 15 days · forecast from tomorrow',
    });
    expect(c('2026-10-21')?.text).toBe('in 16 days · forecast from 7 Oct');
    expect(c('2026-11-20')?.text).toBe('in 46 days · forecast from 6 Nov'); // 20 Nov − 14 days
    expect(c('2026-10-05')?.text).toBe('today · forecast available');
    expect(c('2026-10-01')).toEqual({
      days: -4,
      when: '4 days ago',
      forecast: { kind: 'past' },
      text: '4 days ago',
    });
  });

  it('leaves the forecast out when no provider is known, and gives null for a bad date', () => {
    expect(shootCountdown('2026-10-17', today, null)).toEqual({
      days: 12,
      when: 'in 12 days',
      forecast: null,
      text: 'in 12 days',
    });
    expect(shootCountdown('soon', today, OPEN_METEO_CAPABILITIES)).toBeNull();
  });
});

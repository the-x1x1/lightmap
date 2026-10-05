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
    expect(shortCivilDate('2026-10-13')).toBe('13 Oct');
    expect(shortCivilDate('2026-09-01')).toBe('1 Sep');
    expect(shortCivilDate('2027-09-01', true)).toBe('1 Sep 2027');
    expect(shortCivilDate('nonsense')).toBe('nonsense');
  });

  it('says where the forecast stands for the date against the provider horizons (7 / 16 days)', () => {
    const c = (shootDate: string) => shootCountdown(shootDate, today, OPEN_METEO_CAPABILITIES);
    expect(c('2026-10-17')).toEqual({
      days: 12,
      when: 'in 12 days',
      forecast: { kind: 'extended' },
      text: 'in 12 days · extended forecast available',
    });
    expect(c('2026-10-12')?.text).toBe('in 7 days · forecast available');
    expect(c('2026-10-13')?.text).toBe('in 8 days · extended forecast available');
    expect(c('2026-10-21')?.text).toBe('in 16 days · extended forecast available');
    expect(c('2026-10-22')).toEqual({
      days: 17,
      when: 'in 17 days',
      forecast: { kind: 'ahead', opensOn: '2026-10-06', inDays: 1 },
      text: 'in 17 days · forecast from tomorrow',
    });
    expect(c('2026-11-20')?.text).toBe('in 46 days · forecast from 4 Nov'); // 20 Nov − 16 days
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

import { describe, expect, it } from 'vitest';
import { finderResultsText } from '../../features/finder/results-text.ts';
import type { SerializedMatch } from '../../features/finder/solver-types.ts';

const base: SerializedMatch = {
  date: '2026-05-31',
  via: 'azimuth',
  timestampUtc: '2026-06-01T05:09:00.000Z',
  body: 'sun',
  azimuthDegrees: 292.4,
  elevationDegrees: -0.8,
  elevationErrorDegrees: null,
  withinTolerance: true,
  illuminatedFraction: null,
  apparentDiameterDegrees: 0.53,
  sky: null,
  trend: 'setting',
};

describe('finderResultsText', () => {
  it('one line per moment in the planning zone, with the Moon’s lit share and disc', () => {
    const text = finderResultsText(
      [
        base,
        {
          ...base,
          body: 'moon',
          date: '2026-06-02',
          timestampUtc: '2026-06-03T06:40:00.000Z',
          azimuthDegrees: 110,
          elevationDegrees: 2.3,
          trend: 'rising',
          illuminatedFraction: 0.97,
          apparentDiameterDegrees: 0.551,
        },
      ],
      { timeZone: 'Pacific/Honolulu', body: 'moon', place: 'Kailua Beach' },
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('Moon at Kailua Beach — 2 moments (times Pacific/Honolulu)');
    expect(lines[1]).toBe('2026-05-31 19:09  292° WNW, -0.8° setting');
    expect(lines[2]).toBe('2026-06-02 20:40  110° ESE, 2.3° rising · 97 % lit, 0.55°');
    expect(lines.at(-1)).toMatch(/^Geometry only/);
    expect(finderResultsText([], { timeZone: 'UTC', body: 'sun', place: 'x' })).toContain(
      '0 moments',
    );
  });
});

describe('finderResultsText with a planet', () => {
  it('names the planet and says why an instant cannot be seen', () => {
    const venus: SerializedMatch = {
      ...base,
      body: 'venus',
      timestampUtc: '2026-06-02T07:04:54.000Z',
      date: '2026-06-01',
      azimuthDegrees: 293,
      elevationDegrees: 8.1,
      apparentDiameterDegrees: null,
      sky: 'dark',
    };
    const text = finderResultsText([venus, { ...venus, sky: 'low' }], {
      timeZone: 'Pacific/Honolulu',
      body: 'venus',
      place: 'Kailua Beach',
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Venus at Kailua Beach — 2 moments (times Pacific/Honolulu)');
    expect(lines[1]).toBe('2026-06-01 21:05  293° WNW, 8.1° setting');
    expect(lines[2]).toBe('2026-06-01 21:05  293° WNW, 8.1° setting · low');
  });
});

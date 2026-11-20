import { describe, expect, it } from 'vitest';
import { groundWetnessAt, splitForecastHistory, type WeatherFrame } from '../src/model.ts';

describe('groundWetnessAt', () => {
  const at = new Date('2026-06-01T12:00:00Z');
  const fr = (iso: string, mm: number | null) =>
    ({ timestamp: iso, precipitationAmount: mm }) as unknown as WeatherFrame;
  it('is 0 with no rain, wet just after a shower, drying over hours', () => {
    expect(groundWetnessAt([], at)).toBe(0);
    expect(
      groundWetnessAt([fr('2026-06-01T11:00:00Z', 0), fr('2026-06-01T12:00:00Z', null)], at),
    ).toBe(0);
    const justNow = groundWetnessAt([fr('2026-06-01T12:00:00Z', 2)], at);
    expect(justNow).toBeCloseTo(1 - Math.exp(-2), 6);
    const fourHours = groundWetnessAt([fr('2026-06-01T08:00:00Z', 2)], at);
    expect(fourHours).toBeCloseTo(1 - Math.exp(-2 / Math.E), 6);
    expect(groundWetnessAt([fr('2026-05-31T10:00:00Z', 5)], at)).toBe(0); // yesterday's
  });
  it('counts the hour under way as far as it has gone', () => {
    const half = groundWetnessAt([fr('2026-06-01T12:30:00Z', 2)], at);
    expect(half).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(groundWetnessAt([fr('2026-06-01T14:00:00Z', 2)], at)).toBe(0);
  });
});

describe('splitForecastHistory', () => {
  const fr = (iso: string) => ({ timestamp: iso }) as unknown as WeatherFrame;
  const series = [
    '2026-05-31T22:00:00Z',
    '2026-05-31T23:00:00Z',
    '2026-06-01T00:00:00Z',
    '2026-06-01T01:00:00Z',
    '2026-06-02T09:00:00Z',
  ].map(fr);
  it('cuts at 00:00 UTC of the date the day starts on, wherever in that date it starts', () => {
    // Honolulu's 1 June starts at 10:00 UTC: the day's own request began at 00:00 UTC that date.
    const hnl = splitForecastHistory(series, new Date('2026-06-01T10:00:00Z'));
    expect(hnl.history.map((f) => f.timestamp)).toEqual([
      '2026-05-31T22:00:00Z',
      '2026-05-31T23:00:00Z',
    ]);
    expect(hnl.frames).toHaveLength(3);
    // Berlin's 1 June starts at 22:00 UTC on 31 May: nothing of the series is before that date.
    const ber = splitForecastHistory(series, new Date('2026-05-31T22:00:00Z'));
    expect(ber.history).toHaveLength(0);
    expect(ber.frames).toHaveLength(5);
  });
  it('gives a series with no earlier hours back whole', () => {
    const day = series.slice(2);
    const out = splitForecastHistory(day, new Date('2026-06-01T00:00:00Z'));
    expect(out.history).toEqual([]);
    expect(out.frames).toEqual(day);
  });
});

import { describe, expect, it } from 'vitest';
import { groundWetnessAt, type WeatherFrame } from '../src/model.ts';

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

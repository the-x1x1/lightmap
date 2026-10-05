import { describe, expect, it } from 'vitest';
import { computeDayEvents } from '@lightmap/astronomy';
import { describeSeasonalEnvelope, rangeWidthDeg, seasonalEnvelope } from '../src/seasonal.ts';

describe('seasonal envelope (plan §1 "seasonal path")', () => {
  it('London: sunrise swings from the north-east in June to the south-east in December', () => {
    const e = seasonalEnvelope({ latitude: 51.5, longitude: -0.12 }, 'Europe/London', 2026);
    expect(e.june.sunriseAzimuthDeg).toBeCloseTo(49, 0);
    expect(e.december.sunriseAzimuthDeg).toBeCloseTo(128, 0);
    expect(e.june.sunsetAzimuthDeg).toBeCloseTo(311, 0);
    expect(e.december.sunsetAzimuthDeg).toBeCloseTo(232, 0);
    expect(e.june.noonElevationDeg).toBeCloseTo(62, 0);
    expect(e.december.noonElevationDeg).toBeCloseTo(15, 0);
    expect(e.sunriseRange).toEqual([e.june.sunriseAzimuthDeg, e.december.sunriseAzimuthDeg]);
    expect(e.sunsetRange).toEqual([e.december.sunsetAzimuthDeg, e.june.sunsetAzimuthDeg]);
    expect(e.noonRange[0]).toBeLessThan(e.noonRange[1]);
    expect(rangeWidthDeg(e.sunriseRange!)).toBeCloseTo(79.5, 0);
  });

  it('is symmetric about east/west and matches the day events it is built from', () => {
    const point = { latitude: 21.397, longitude: -157.727 };
    const e = seasonalEnvelope(point, 'Pacific/Honolulu', 2026);
    // Sunset mirrors sunrise about the meridian within a fraction of a degree (refraction, motion).
    expect(e.june.sunriseAzimuthDeg! + e.june.sunsetAzimuthDeg!).toBeCloseTo(360, 0);
    expect(e.december.sunriseAzimuthDeg! + e.december.sunsetAzimuthDeg!).toBeCloseTo(360, 0);
    const ev = computeDayEvents({
      ...point,
      timeZone: 'Pacific/Honolulu',
      date: { year: 2026, month: 6, day: 21 },
    });
    expect(e.june.daylightMinutes).toBe(ev.daylightMinutes);
    // Noon is the transit itself: at or a fraction above the day's sampled maximum.
    expect(e.june.noonElevationDeg).toBeGreaterThanOrEqual(ev.maxElevationDeg - 1e-9);
    expect(e.june.noonElevationDeg - ev.maxElevationDeg).toBeLessThan(0.5);
  });

  it('southern hemisphere: the December noon is the high one; the sweep stays the shorter arc', () => {
    const e = seasonalEnvelope({ latitude: -33.87, longitude: 151.2 }, 'Australia/Sydney', 2026);
    expect(e.december.noonElevationDeg).toBeGreaterThan(e.june.noonElevationDeg);
    expect(e.noonRange).toEqual([e.june.noonElevationDeg, e.december.noonElevationDeg]);
    expect(rangeWidthDeg(e.sunriseRange!)).toBeLessThan(180);
    expect(rangeWidthDeg(e.sunsetRange!)).toBeLessThan(180);
  });

  it('polar places: no range when a solstice has no sunrise; the condition is named', () => {
    const e = seasonalEnvelope({ latitude: 69.65, longitude: 18.96 }, 'Europe/Oslo', 2026);
    expect(e.june.polar).toBe('midnight-sun');
    expect(e.december.polar).toBe('polar-night');
    expect(e.sunriseRange).toBeNull();
    expect(e.sunsetRange).toBeNull();
    expect(e.december.noonElevationDeg).toBeLessThan(0);
    expect(describeSeasonalEnvelope(e)).toBe(
      'June: midnight sun; December: polar night; noon -3°–44°',
    );
    // Just inside the Arctic circle: midnight sun in June, an ordinary (low) December day — the
    // December bearings are still given, and a noon a hair under 0° never reads "-0°".
    const bodo = seasonalEnvelope({ latitude: 67.28, longitude: 14.4 }, 'Europe/Oslo', 2026);
    expect(bodo.june.polar).toBe('midnight-sun');
    expect(bodo.december.polar).toBe('normal');
    expect(bodo.sunriseRange).toBeNull();
    const line = describeSeasonalEnvelope(bodo);
    expect(line).toMatch(
      /^June: midnight sun; December: sunrise \d+° \([A-Z]+\), sunset \d+° \([A-Z]+\); noon /,
    );
    expect(line).not.toContain('-0°');
  });

  it('reads out as one line with compass names', () => {
    const e = seasonalEnvelope({ latitude: 21.397, longitude: -157.727 }, 'Pacific/Honolulu', 2026);
    expect(describeSeasonalEnvelope(e)).toBe(
      'Sunrise 64°–115° (ENE–ESE), sunset 245°–296° (WSW–WNW), noon 45°–88°',
    );
  });
});

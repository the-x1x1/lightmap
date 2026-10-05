import { describe, expect, it } from 'vitest';
import { decideWeatherMode, forecastCacheKey } from '../src/horizon.ts';
import { OPEN_METEO_CAPABILITIES } from '../src/providers/open-meteo.ts';

const now = new Date('2026-05-01T00:00:00Z');
const h = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

describe('decideWeatherMode', () => {
  it('is FORECAST inside the reliable horizon, HIGH confidence within 48 h', () => {
    expect(decideWeatherMode(h(12), now, OPEN_METEO_CAPABILITIES)).toMatchObject({
      mode: 'FORECAST',
      weatherConfidence: 'HIGH',
      fetchWorthwhile: true,
    });
    expect(decideWeatherMode(h(5 * 24), now, OPEN_METEO_CAPABILITIES)).toMatchObject({
      mode: 'FORECAST',
      weatherConfidence: 'MEDIUM',
    });
  });
  it('is EXTENDED between reliable and max horizon', () => {
    expect(decideWeatherMode(h(10 * 24), now, OPEN_METEO_CAPABILITIES)).toMatchObject({
      mode: 'EXTENDED_FORECAST',
      weatherConfidence: 'LOW',
    });
  });
  it('is SCENARIO beyond the provider horizon and never calls it a forecast', () => {
    const d = decideWeatherMode(new Date('2026-05-31T22:30:00Z'), now, OPEN_METEO_CAPABILITIES);
    expect(d.mode).toBe('SCENARIO');
    expect(d.weatherConfidence).toBe('SCENARIO');
    expect(d.fetchWorthwhile).toBe(false);
    expect(d.reason.toLowerCase()).toContain('unavailable');
  });
  it('is SCENARIO with no provider', () => {
    expect(decideWeatherMode(h(1), now, null).mode).toBe('SCENARIO');
  });
  it('serves the recent past from the model archive, older history from the reanalysis, and refuses the rest', () => {
    const recent = decideWeatherMode(h(-3 * 24), now, OPEN_METEO_CAPABILITIES);
    expect(recent.mode).toBe('RECENT_PAST');
    expect(recent.weatherConfidence).toBe('HIGH');
    const archive = decideWeatherMode(h(-200 * 24), now, OPEN_METEO_CAPABILITIES);
    expect(archive.mode).toBe('RECENT_PAST');
    expect(archive.weatherConfidence).toBe('MEDIUM');
    expect(archive.fetchWorthwhile).toBe(true);
    expect(archive.reason).toContain('reanalysis');
    const old = decideWeatherMode(h(-90 * 365 * 24), now, OPEN_METEO_CAPABILITIES);
    expect(old.mode).toBe('PAST');
    expect(old.weatherConfidence).toBe('SCENARIO');
    expect(old.fetchWorthwhile).toBe(false);
    // A provider without an archive refuses anything beyond its recent past.
    const noArchive = decideWeatherMode(h(-200 * 24), now, {
      ...OPEN_METEO_CAPABILITIES,
      archiveDays: 0,
    });
    expect(noArchive.mode).toBe('PAST');
  });
  it('cache key quantises by provider, grid and day', () => {
    expect(forecastCacheKey('open-meteo', '21.4000,-157.7500', '2026-05-31')).toBe(
      'weather:open-meteo:v1:21.4000,-157.7500:2026-05-31',
    );
  });
});

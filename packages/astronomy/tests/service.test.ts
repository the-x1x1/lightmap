import { describe, expect, it } from 'vitest';
import { MeeusAstronomyService, compassFromAzimuth, localSelectionToUtc } from '../src/service.ts';
import { lightPhase, twilightBand } from '../src/events.ts';
import { refractionDeg } from '../src/solar.ts';

const svc = new MeeusAstronomyService();
const kailua = { latitude: 21.397, longitude: -157.727, timeZone: 'Pacific/Honolulu' };

describe('MeeusAstronomyService', () => {
  it('Kailua, 31 May 2026 12:30 HST: sun almost overhead, slightly north (the plan\'s acceptance case)', () => {
    const s = svc.getSolarState({ ...kailua, timestampUtc: localSelectionToUtc({ year: 2026, month: 5, day: 31 }, 12 * 60 + 30, kailua.timeZone) });
    expect(s.elevationDegrees).toBeGreaterThan(89);
    expect(s.isAboveHorizon).toBe(true);
    expect(s.phase).toBe('day');
    expect(s.local.hour).toBe(12);
    expect(s.local.minute).toBe(30);
    expect(s.solarTime).toBeCloseTo(12.02, 1); // solar noon was 12:29 HST
    expect(s.compass).toBe('NNW');
    expect(s.zenithDegrees).toBeCloseTo(90 - s.elevationDegrees, 10);
  });

  it('runs fast enough for per-frame timeline scrubbing (< 16 ms for 200 calls)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) svc.getSolarState({ ...kailua, timestampUtc: new Date(Date.UTC(2026, 4, 31, 0, i * 7)) });
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('day events for Kailua carry the golden and blue hour windows in order', () => {
    const ev = svc.getDayEvents({ ...kailua, date: { year: 2026, month: 5, day: 31 } });
    const order = [ev.astronomicalDawn, ev.nauticalDawn, ev.dawn, ev.goldenHourMorningStart, ev.sunrise, ev.goldenHourMorningEnd, ev.solarNoon, ev.goldenHourEveningStart, ev.sunset, ev.goldenHourEveningEnd, ev.civilDusk, ev.nauticalDusk, ev.astronomicalDusk];
    for (const d of order) expect(d).not.toBeNull();
    for (let i = 1; i < order.length; i++) expect(order[i]!.getTime()).toBeGreaterThan(order[i - 1]!.getTime());
    expect(ev.polar).toBe('normal');
    expect(ev.daylightMinutes).toBeGreaterThan(13 * 60);
    expect(ev.daylightMinutes).toBeLessThan(13.5 * 60);
  });

  it('polar night in Tromsø has no sunrise but has civil twilight and a below-horizon noon', () => {
    const ev = svc.getDayEvents({ latitude: 69.6492, longitude: 18.9553, timeZone: 'Europe/Oslo', date: { year: 2026, month: 12, day: 21 } });
    expect(ev.polar).toBe('polar-night');
    expect(ev.sunrise).toBeNull();
    expect(ev.dawn).not.toBeNull();
    expect(ev.maxElevationDeg).toBeLessThan(-0.833);
    expect(ev.maxElevationDeg).toBeGreaterThan(-6);
    expect(ev.daylightMinutes).toBe(0);
    expect(ev.notes[0]).toContain('continuously below');
  });

  it('midnight sun in Tromsø has no sunset and 24 h of daylight', () => {
    const ev = svc.getDayEvents({ latitude: 69.6492, longitude: 18.9553, timeZone: 'Europe/Oslo', date: { year: 2026, month: 6, day: 21 } });
    expect(ev.polar).toBe('midnight-sun');
    expect(ev.sunset).toBeNull();
    expect(ev.daylightMinutes).toBe(1440);
    expect(ev.solarMidnight).not.toBeNull();
  });

  it('lunar state reports the full moon over Kailua with an honest accuracy note', () => {
    // Full Moon instant: 2026-05-30 22:45 HST (08:45Z on the 31st). Two hours later it is named 'Full Moon'; before it, 'Waxing Gibbous' (see moonPhaseName).
    const l = svc.getLunarState({ ...kailua, timestampUtc: new Date('2026-05-31T10:45:00Z') });
    const before = svc.getLunarState({ ...kailua, timestampUtc: new Date('2026-05-31T07:45:00Z') });
    expect(before.phaseName).toBe('Waxing Gibbous');
    expect(l.illuminatedFraction).toBeGreaterThan(0.98);
    expect(l.phaseName).toBe('Full Moon');
    expect(l.accuracyNote).toContain('±0.3°');
    expect(l.moonrise === null || l.moonrise instanceof Date).toBe(true);
  });

  it('classifies light phases by elevation with configurable thresholds', () => {
    expect(lightPhase(30)).toBe('day');
    expect(lightPhase(3)).toBe('golden-hour');
    expect(lightPhase(-2)).toBe('golden-hour');
    expect(lightPhase(-5)).toBe('blue-hour');
    expect(lightPhase(-8)).toBe('nautical-twilight');
    expect(lightPhase(-15)).toBe('astronomical-twilight');
    expect(lightPhase(-20)).toBe('night');
    expect(twilightBand(-3)).toBe('civil');
    expect(twilightBand(-13)).toBe('astronomical');
  });

  it('refraction lifts the horizon by about 34 arcminutes and vanishes at altitude', () => {
    expect(refractionDeg(0) * 60).toBeGreaterThan(28);
    expect(refractionDeg(0) * 60).toBeLessThan(36);
    expect(refractionDeg(45)).toBeLessThan(0.02);
    expect(refractionDeg(-5)).toBe(0);
  });

  it('compass labels', () => {
    expect(compassFromAzimuth(0)).toBe('N');
    expect(compassFromAzimuth(112.5)).toBe('ESE');
    expect(compassFromAzimuth(348.75)).toBe('N');
  });
});

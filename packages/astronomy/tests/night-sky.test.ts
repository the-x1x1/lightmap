import { describe, expect, it } from 'vitest';
import {
  GALACTIC_CENTRE_J2000,
  galacticCentrePosition,
  milkyWayCore,
  milkyWayCoreFrom,
  precessFromJ2000,
} from '../src/night-sky.ts';

function transit(lat: number, lon: number, dayIso: string) {
  const day = Date.parse(dayIso);
  let best = { el: -99, az: 0 };
  for (let m = 0; m < 1440; m++) {
    const p = galacticCentrePosition(new Date(day + m * 60_000), lat, lon);
    if (p.elevationDeg > best.el) best = { el: p.elevationDeg, az: p.azimuthDeg };
  }
  return best;
}

describe('Galactic Centre (Milky Way core)', () => {
  it('precession moves the J2000 place by about 0.4° of RA a quarter-century on', () => {
    const p = precessFromJ2000(
      GALACTIC_CENTRE_J2000.rightAscensionDeg,
      GALACTIC_CENTRE_J2000.declinationDeg,
      0.26,
    );
    expect(p.rightAscensionDeg - GALACTIC_CENTRE_J2000.rightAscensionDeg).toBeCloseTo(0.41, 1);
    expect(p.declinationDeg - GALACTIC_CENTRE_J2000.declinationDeg).toBeCloseTo(-0.01, 1);
    const same = precessFromJ2000(10, 20, 0);
    expect(same.rightAscensionDeg).toBeCloseTo(10, 6);
    expect(same.declinationDeg).toBeCloseTo(20, 6);
  });

  it('culminates at 90° − |latitude − declination|, due south in the north and due north far south', () => {
    const kailua = transit(21.397, -157.727, '2026-06-15T00:00:00Z');
    expect(kailua.el).toBeCloseTo(90 - (21.397 + 29.0), 0);
    expect(kailua.az).toBeCloseTo(180, 0);
    const sydney = transit(-33.87, 151.2, '2026-06-15T00:00:00Z');
    expect(sydney.el).toBeCloseTo(90 - (33.87 - 29.0), 0);
    expect(Math.min(sydney.az, 360 - sydney.az)).toBeLessThan(1);
    const london = transit(51.5, -0.12, '2026-06-15T00:00:00Z');
    expect(london.el).toBeCloseTo(9.5, 0); // never high from Britain
  });

  it('rules a night in or out the way a photographer would', () => {
    const kailua = [21.397, -157.727] as const;
    // New Moon night, 02:00 HST: dark, core 36° up in the SSW.
    const good = milkyWayCore(new Date('2026-06-15T12:00:00Z'), ...kailua);
    expect(good.verdict).toBe('visible');
    expect(good.elevationDeg).toBeGreaterThan(30);
    expect(good.moonUp).toBe(false);
    // Full Moon night: the core is up but the sky is washed out.
    const moonlit = milkyWayCore(new Date('2026-05-31T12:00:00Z'), ...kailua);
    expect(moonlit.verdict).toBe('moonlit');
    expect(moonlit.moonIlluminatedFraction).toBeGreaterThan(0.95);
    // Noon.
    expect(milkyWayCore(new Date('2026-06-15T22:30:00Z'), ...kailua).verdict).toBe('daylight');
    // Just after sunset: twilight, not yet astronomical night.
    expect(milkyWayCore(new Date('2026-06-15T05:50:00Z'), ...kailua).verdict).toBe('twilight');
    // Northern winter night: the core is below the horizon at midnight.
    expect(milkyWayCore(new Date('2026-12-15T10:00:00Z'), ...kailua).verdict).toBe('below-horizon');
    // A low core in astronomical night; a thin Moon does not spoil a high one; a bright one does.
    const low = milkyWayCoreFrom({ azimuthDeg: 160, elevationDeg: 6 }, -20, false, 0);
    expect(low.verdict).toBe('low');
    expect(low.reason).toBe('Core only 6° up: in haze near the horizon');
    const thin = milkyWayCoreFrom({ azimuthDeg: 180, elevationDeg: 40 }, -20, true, 0.2);
    expect(thin.verdict).toBe('visible');
    expect(thin.reason).toBe('Astronomical night, core 40° up, thin Moon');
    const bright = milkyWayCoreFrom({ azimuthDeg: 180, elevationDeg: 40 }, -20, true, 0.31);
    expect(bright.verdict).toBe('moonlit');
    expect(bright.reason).toBe('Moon up and 31 % lit: the sky is too bright');
    // The Sun decides before anything else: a core 40° up at noon is still daylight.
    expect(milkyWayCoreFrom({ azimuthDeg: 180, elevationDeg: 40 }, 30, false, 0).verdict).toBe(
      'daylight',
    );
    expect(milkyWayCoreFrom({ azimuthDeg: 180, elevationDeg: 40 }, -10, false, 0).reason).toBe(
      'Twilight (Sun -10°): the band needs astronomical night',
    );
  });
});

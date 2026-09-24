/**
 * Golden tests against the US Naval Observatory (tests/fixtures/usno-golden.json).
 * Times: USNO rounds to the minute, so we allow ±1 minute (±2 at Tromsø, where the Sun grazes the
 * twilight threshold and a hundredth of a degree moves the crossing by a minute).
 * Positions: compared as the angular separation between unit direction vectors, because azimuth
 * alone is ill-conditioned near the zenith (Kailua at 89.3° elevation).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeDayEvents } from '../src/events.ts';
import { sunPosition } from '../src/solar.ts';
import { moonPosition } from '../src/lunar.ts';
import { etcZone } from './helpers.ts';

interface Golden {
  cases: Array<{
    case: string;
    place: string;
    lat: number;
    lon: number;
    date: string;
    tzHours: number;
    sun: Record<
      'beginCivilTwilight' | 'rise' | 'transit' | 'set' | 'endCivilTwilight',
      string | null
    >;
    moon: { curphase: string; fracillum: string };
    altaz: Array<{ utc: string; altitudeDeg: number; azimuthDeg: number }>;
  }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(join(here, 'fixtures', 'usno-golden.json'), 'utf8'),
) as Golden;

function hhmm(d: Date | null, tzHours: number): string | null {
  if (!d) return null;
  const local = new Date(d.getTime() + tzHours * 3_600_000);
  return `${local.getUTCHours().toString().padStart(2, '0')}:${local.getUTCMinutes().toString().padStart(2, '0')}`;
}

function minutesApart(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number) as [number, number];
  const [bh, bm] = b.split(':').map(Number) as [number, number];
  let d = Math.abs(ah * 60 + am - (bh * 60 + bm));
  if (d > 720) d = 1440 - d;
  return d;
}

function unit(azDeg: number, elDeg: number): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
}

function separationDeg(a: [number, number, number], b: [number, number, number]): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(dot) * 180) / Math.PI;
}

describe('USNO golden set', () => {
  for (const c of golden.cases) {
    describe(`${c.case} ${c.place}`, () => {
      const [y, m, d] = c.date.split('-').map(Number) as [number, number, number];
      const tz = etcZone(c.tzHours);
      const tolerance = Math.abs(c.lat) > 66 ? 2 : 1;

      it('matches rise, set, transit and civil twilight to the minute', () => {
        const ev = computeDayEvents({
          latitude: c.lat,
          longitude: c.lon,
          date: { year: y, month: m, day: d },
          timeZone: tz,
        });
        const got = {
          beginCivilTwilight: hhmm(ev.dawn, c.tzHours),
          rise: hhmm(ev.sunrise, c.tzHours),
          transit: hhmm(ev.solarNoon, c.tzHours),
          set: hhmm(ev.sunset, c.tzHours),
          endCivilTwilight: hhmm(ev.civilDusk, c.tzHours),
        };
        for (const key of Object.keys(c.sun) as Array<keyof typeof c.sun>) {
          const want = c.sun[key];
          const have = got[key];
          if (want === null) {
            if (
              key === 'transit' &&
              c.sun.rise === null &&
              c.sun.set === null &&
              c.sun.beginCivilTwilight !== null
            ) {
              // USNO omits the transit row in polar night; the Sun still culminates (below the
              // horizon) and LightMap reports that instant because twilight peaks there.
              expect(ev.polar).toBe('polar-night');
              expect(have).not.toBeNull();
              continue;
            }
            expect(have, `${key} should not occur`).toBeNull();
          } else {
            expect(have, `${key} missing`).not.toBeNull();
            expect(
              minutesApart(have!, want),
              `${key}: got ${have}, USNO ${want}`,
            ).toBeLessThanOrEqual(tolerance);
          }
        }
      });

      for (const a of c.altaz) {
        it(`sun direction at ${a.utc} within 0.02° of USNO`, () => {
          const p = sunPosition(new Date(a.utc), c.lat, c.lon);
          const sep = separationDeg(
            unit(p.azimuthDeg, p.elevationDeg),
            unit(a.azimuthDeg, a.altitudeDeg),
          );
          expect(sep).toBeLessThan(0.02);
          expect(Math.abs(p.elevationDeg - a.altitudeDeg)).toBeLessThan(0.01);
        });
      }

      it('moon illumination and phase name agree with USNO', () => {
        // USNO's curphase/fracillum for a "one day" query refer to local noon-ish; use 12:00 local.
        const t = new Date(Date.UTC(y, m - 1, d, 12 - c.tzHours, 0, 0));
        const mp = moonPosition(t, c.lat, c.lon);
        const usnoFrac = Number(c.moon.fracillum.replace('%', '')) / 100;
        expect(Math.abs(mp.illuminatedFraction - usnoFrac)).toBeLessThan(0.03);
        expect(mp.phaseName).toBe(c.moon.curphase);
      });
    });
  }
});

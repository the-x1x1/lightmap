import { describe, expect, it } from 'vitest';
import {
  aboveTerrain,
  elevationAngleDeg,
  formatDeg,
  horizonElevationAt,
  horizonProfileFromSamples,
  horizonRingDistances,
  horizonSamplePoints,
  seaHorizonDipDeg,
  terrainSunEvents,
  type HorizonSample,
} from '../src/horizon.ts';

const origin = { latitude: 46.5, longitude: 7.9 };
const source = { providerId: 'test-dem', resolutionM: 30 };

/** The sampling ring nearest 2 km. */
const RIDGE_RING = horizonRingDistances().reduce((best, d) =>
  Math.abs(d - 2000) < Math.abs(best - 2000) ? d : best,
);
const RIDGE_ELEVATION = elevationAngleDeg(RIDGE_RING, 300, 1.6);

/** A 300 m ridge on the ~2 km ring between azimuths 80° and 100°; flat elsewhere. */
function ridgeSamples(): HorizonSample[] {
  const out: HorizonSample[] = [];
  for (const p of horizonSamplePoints(origin)) {
    const onRidge = p.azimuthDeg >= 80 && p.azimuthDeg <= 100 && p.distanceM === RIDGE_RING;
    out.push({ azimuthDeg: p.azimuthDeg, distanceM: p.distanceM, heightM: onRidge ? 300 : 0 });
  }
  return out;
}

describe('terrain horizon profile', () => {
  it('samples log-spaced rings on every azimuth step', () => {
    const d = horizonRingDistances();
    expect(d[0]).toBe(40);
    expect(d[d.length - 1]).toBe(40_000);
    expect(d.every((v, i) => i === 0 || v > d[i - 1]!)).toBe(true);
    const pts = horizonSamplePoints(origin, { stepDeg: 10, rings: 5 });
    expect(pts).toHaveLength(36 * 5);
    expect(pts[0]).toMatchObject({ azimuthDeg: 0, distanceM: 40 });
  });

  it('elevation angles include curvature and refraction; the sea horizon dips with eye height', () => {
    // A 300 m point 2 km away from a 1.6 m eye: ≈ atan(298 / 2000) ≈ 8.5°, minus a 0.27 m drop.
    expect(elevationAngleDeg(2000, 300, 1.6)).toBeCloseTo(8.48, 1);
    // Sea level 40 km away seen from 100 m up is below the horizontal, not on it.
    expect(elevationAngleDeg(40_000, 0, 100)).toBeLessThan(-0.2);
    expect(seaHorizonDipDeg(0)).toBe(0);
    expect(seaHorizonDipDeg(100)).toBeCloseTo(-0.3, 1); // ≈ −sqrt(2h/R′) ≈ −0.30°
  });

  it('builds the profile from samples and reports the ridge with its distance', () => {
    const p = horizonProfileFromSamples(origin, 0, 1.6, ridgeSamples(), source);
    expect(p.stepDeg).toBe(3);
    expect(p.elevationDeg).toHaveLength(120);
    expect(p.coverage).toBe(1);
    expect(horizonElevationAt(p, 90)).toBeCloseTo(RIDGE_ELEVATION, 6);
    expect(RIDGE_ELEVATION).toBeGreaterThan(8);
    expect(p.distanceM[30]).toBe(RIDGE_RING); // index 30 = 90°
    expect(horizonElevationAt(p, 270)).toBeCloseTo(seaHorizonDipDeg(1.6), 6); // flat: the dip
    expect(p.maxElevationDeg).toBeCloseTo(RIDGE_ELEVATION, 6);
    expect(p.caveat).toContain('trees');
    // Interpolation between 78° (flat) and 81° (ridge) is monotonic.
    const a = horizonElevationAt(p, 78);
    const b = horizonElevationAt(p, 79.5);
    const c = horizonElevationAt(p, 81);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('ignores missing samples and reports coverage', () => {
    const s = ridgeSamples().map((x, i) => (i % 2 ? { ...x, heightM: null } : x));
    const p = horizonProfileFromSamples(origin, 0, 1.6, s, source);
    expect(p.coverage).toBeCloseTo(0.5, 6);
    expect(p.elevationDeg.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('decides whether the Sun shows above the terrain, upper limb and refraction included', () => {
    const p = horizonProfileFromSamples(origin, 0, 1.6, ridgeSamples(), source);
    expect(aboveTerrain(p, 90, 5)).toBe(false);
    expect(aboveTerrain(p, 90, 10)).toBe(true);
    // Flat horizon: astronomical sunrise (−0.833°) is right at the limit.
    expect(aboveTerrain(p, 270, -0.8)).toBe(true);
    expect(aboveTerrain(p, 270, -1.2)).toBe(false);
  });

  it("finds the day's first light over the ridge later than astronomical sunrise", () => {
    const p = horizonProfileFromSamples(origin, 0, 1.6, ridgeSamples(), source);
    const dayStart = new Date('2026-06-21T00:00:00Z');
    const dayEnd = new Date('2026-06-22T00:00:00Z');
    // Toy sun: due east all morning, rising 5°/h from −10° at midnight, then symmetric descent.
    const positionAt = (t: Date) => {
      const h = (t.getTime() - dayStart.getTime()) / 3_600_000;
      const el = h <= 12 ? -10 + 5 * h : -10 + 5 * (24 - h);
      return { azimuthDeg: h <= 12 ? 90 : 270, elevationDeg: el };
    };
    const sunrise = new Date(dayStart.getTime() + ((10 - 0.833) / 5) * 3_600_000);
    const sunset = new Date(dayStart.getTime() + (24 - (10 - 0.833) / 5) * 3_600_000);
    const ev = terrainSunEvents(p, positionAt, { dayStart, dayEnd, sunrise, sunset });
    expect(ev.visible).toHaveLength(1);
    // The ridge is cleared when apparent + 0.27 ≥ its elevation: geometric ≈ ridge − 0.4°.
    const firstH = (ev.firstLight!.getTime() - dayStart.getTime()) / 3_600_000;
    const expectedH = (10 + RIDGE_ELEVATION - 0.4) / 5;
    expect(Math.abs(firstH - expectedH)).toBeLessThan(0.05);
    expect(ev.firstLight!.getTime()).toBeGreaterThan(sunrise.getTime() + 60 * 60_000);
    // Setting over flat ground in the west: last light equals astronomical sunset within the
    // refraction-convention tolerance (the toy sun sinks slowly: 5°/h).
    expect(Math.abs(ev.lastLight!.getTime() - sunset.getTime())).toBeLessThan(3 * 60_000);
    expect(ev.differsFromAstronomical).toBe(true);

    const flat = horizonProfileFromSamples(
      origin,
      0,
      1.6,
      ridgeSamples().map((s) => ({ ...s, heightM: 0 })),
      source,
    );
    const ev2 = terrainSunEvents(flat, positionAt, { dayStart, dayEnd, sunrise, sunset });
    expect(ev2.differsFromAstronomical).toBe(false);
    expect(Math.abs(ev2.firstLight!.getTime() - sunrise.getTime())).toBeLessThan(3 * 60_000);
  });
});

describe('terrain sun events at the edges of the day', () => {
  const p = horizonProfileFromSamples(
    origin,
    0,
    1.6,
    ridgeSamples().map((s) => ({ ...s, heightM: 0 })),
    source,
  );
  const dayStart = new Date('2026-06-21T00:00:00Z');
  const dayEnd = new Date('2026-06-22T00:00:00Z');

  it('polar summer: up all day is not a "first light" at 00:00, and matches astronomy', () => {
    const ev = terrainSunEvents(p, () => ({ azimuthDeg: 180, elevationDeg: 10 }), {
      dayStart,
      dayEnd,
      sunrise: null,
      sunset: null,
    });
    expect(ev.visible).toEqual([{ from: dayStart, to: dayEnd }]);
    expect(ev.startsVisible).toBe(true);
    expect(ev.endsVisible).toBe(true);
    expect(ev.firstLight).toBeNull();
    expect(ev.lastLight).toBeNull();
    expect(ev.differsFromAstronomical).toBe(false);
  });

  it('polar night: never visible, matches astronomy', () => {
    const ev = terrainSunEvents(p, () => ({ azimuthDeg: 180, elevationDeg: -10 }), {
      dayStart,
      dayEnd,
      sunrise: null,
      sunset: null,
    });
    expect(ev.visible).toEqual([]);
    expect(ev.firstLight).toBeNull();
    expect(ev.differsFromAstronomical).toBe(false);
  });

  it('the day the Sun stops setting: rises normally, still up at the day end', () => {
    // Rises through 0° at 03:00 and stays up.
    const positionAt = (t: Date) => {
      const h = (t.getTime() - dayStart.getTime()) / 3_600_000;
      return { azimuthDeg: 90, elevationDeg: Math.min(5, -15 + 5 * h) };
    };
    const sunrise = new Date(dayStart.getTime() + ((15 - 0.833) / 5) * 3_600_000);
    const ev = terrainSunEvents(p, positionAt, { dayStart, dayEnd, sunrise, sunset: null });
    expect(ev.startsVisible).toBe(false);
    expect(ev.endsVisible).toBe(true);
    expect(ev.lastLight).toBeNull();
    expect(Math.abs(ev.firstLight!.getTime() - sunrise.getTime())).toBeLessThan(3 * 60_000);
    expect(ev.firstLightDiffers).toBe(false);
    expect(ev.lastLightDiffers).toBe(false);
    expect(ev.differsFromAstronomical).toBe(false);
  });

  it('formats small dips as 0.0, not -0.0', () => {
    expect(formatDeg(-0.03)).toBe('0.0');
    expect(formatDeg(-0.06)).toBe('-0.1');
    expect(formatDeg(8.48)).toBe('8.5');
    expect(formatDeg(0)).toBe('0.0');
  });
});

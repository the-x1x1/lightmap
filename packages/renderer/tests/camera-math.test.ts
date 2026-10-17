import { describe, expect, it } from 'vitest';
import {
  altitudeForBounds,
  altitudeToZoom,
  clampOrbit,
  clearOrbitPitch,
  eyeDistanceM,
  eyeGlideDurationMs,
  glideEyeAt,
  normalizeHeadingDegrees,
  orbitSightLine,
  steeperPitches,
  zoomToAltitudeM,
} from '../src/camera-math.ts';

describe('camera math (ported from WorldView view.ts / contract.ts)', () => {
  it('normalises headings', () => {
    expect(normalizeHeadingDegrees(-10)).toBe(350);
    expect(normalizeHeadingDegrees(370)).toBe(10);
    expect(normalizeHeadingDegrees(360)).toBe(0);
  });
  it('zoom ↔ altitude round-trips and is monotone', () => {
    for (const z of [2, 8, 12, 16])
      expect(altitudeToZoom(zoomToAltitudeM(z, 21.4), 21.4)).toBeCloseTo(z, 6);
    expect(zoomToAltitudeM(10)).toBeGreaterThan(zoomToAltitudeM(14));
    expect(zoomToAltitudeM(30)).toBe(10); // floor
    expect(altitudeToZoom(1e12)).toBe(0);
    expect(altitudeToZoom(0.001)).toBe(22);
  });
  it('frames bounds with a margin', () => {
    const alt = altitudeForBounds({ west: -157.8, south: 21.3, east: -157.6, north: 21.5 });
    expect(alt).toBeGreaterThan(20_000);
    expect(alt).toBeLessThan(30_000);
    expect(altitudeForBounds({ west: 0, south: 0, east: 0.0001, north: 0.0001 })).toBe(500);
    // Dateline-crossing bounds.
    expect(altitudeForBounds({ west: 179, south: -1, east: -179, north: 1 })).toBeGreaterThan(
      200_000,
    );
  });
  it('clamps orbit views', () => {
    expect(clampOrbit({ headingDeg: 400, pitchDeg: 10, rangeM: 1 })).toEqual({
      headingDeg: 40,
      pitchDeg: -5,
      rangeM: 50,
    });
    expect(clampOrbit({ headingDeg: 0, pitchDeg: -95, rangeM: 1e9 }).pitchDeg).toBe(-89);
  });
});

describe('orbit terrain clearance', () => {
  const target = { latitude: 37.7327, longitude: -119.6057, heightM: 1200 };

  it('puts the camera back along the view: heading north, pitch −30° → south of and above the target', () => {
    const line = orbitSightLine(target, 0, -30, 2000, 4);
    const cam = line[0]!;
    expect(cam.latitude).toBeLessThan(target.latitude);
    expect(cam.longitude).toBeCloseTo(target.longitude, 9);
    expect(cam.heightM).toBeCloseTo(1200 + 1000, 6);
    // 2000 m × cos 30° ≈ 1732 m south.
    expect((target.latitude - cam.latitude) * 111_320).toBeCloseTo(1732, 0);
    expect(line).toHaveLength(4);
    expect(line.at(-1)!.heightM).toBeCloseTo(1200 + 250, 6);
  });

  it('steepens until the camera and its sight line clear the ground (a valley wall)', () => {
    const pitches = steeperPitches(-20);
    expect(pitches[0]).toBe(-20);
    expect(pitches.at(-1)).toBe(-85);
    const candidates = pitches.map((p) => ({
      pitchDeg: p,
      line: orbitSightLine(target, 0, p, 1500),
    }));
    // A 1 000 m wall everywhere more than 400 m from the target.
    const ground = (ci: number, pi: number) => {
      const pt = candidates[ci]!.line[pi]!;
      const d = Math.abs(target.latitude - pt.latitude) * 111_320;
      return d > 400 ? 2200 : 1200;
    };
    const p = clearOrbitPitch(-20, candidates, ground);
    expect(p).toBeLessThan(-20);
    const chosen = candidates.find((c) => c.pitchDeg === p)!;
    chosen.line.forEach((pt, i) => {
      const d = Math.abs(target.latitude - pt.latitude) * 111_320;
      expect(pt.heightM).toBeGreaterThanOrEqual((d > 400 ? 2200 : 1200) + 40 - 1e-6);
      expect(i).toBeGreaterThanOrEqual(0);
    });
    // Open ground: the requested pitch stands; unknown ground counts as clear.
    expect(clearOrbitPitch(-20, candidates, () => 1200)).toBe(-20);
    expect(clearOrbitPitch(-20, candidates, () => null)).toBe(-20);
  });
});

describe('the viewpoint eye glides between steps', () => {
  const at = { longitude: 7.9, latitude: 46.5, heightM: 1000 };
  const ahead = (m: number) => ({ ...at, latitude: at.latitude + m / 110_540 });

  it('moves at a steady speed and is at the step when the glide ends', () => {
    const goal = ahead(0.6); // a 100 ms walk step at 6 m/s
    const ms = eyeGlideDurationMs(100);
    expect(ms).toBe(100);
    const d = (t: number) => eyeDistanceM(at, glideEyeAt(at, goal, t, ms).eye);
    // Equal distances in equal times: no surge and stop each step.
    expect(d(25)).toBeCloseTo(0.15, 3);
    expect(d(50)).toBeCloseTo(0.3, 3);
    expect(d(75)).toBeCloseTo(0.45, 3);
    const end = glideEyeAt(at, goal, 100, ms);
    expect(end.done).toBe(true);
    expect(end.eye).toEqual(goal);
  });

  it('bounds the glide: a lone step takes a quarter second, rapid ones at least 40 ms', () => {
    expect(eyeGlideDurationMs(5_000)).toBe(250);
    expect(eyeGlideDurationMs(5)).toBe(40);
    expect(glideEyeAt(at, ahead(2), 0, 0)).toEqual({ eye: ahead(2), done: true });
  });
});

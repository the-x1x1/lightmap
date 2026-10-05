import { describe, expect, it } from 'vitest';
import { HORIZON_PLACEMENTS, levelLineY, pitchForHorizonAt, skylinePath } from '../src/level.ts';
import { directionFromFrame, frameCoordinates } from '../src/camera.ts';

const cam = (pitchDeg: number, fovDeg = 60, headingDeg = 120) => ({ headingDeg, pitchDeg, fovDeg });

describe('horizon levelling', () => {
  it('true level is the frame centre at zero pitch and drops as the camera looks up', () => {
    expect(levelLineY(cam(0))).toBe(0);
    expect(levelLineY(cam(5))!).toBeLessThan(0);
    expect(levelLineY(cam(-5))!).toBeGreaterThan(0);
    // Look far enough up and level leaves the frame.
    expect(levelLineY(cam(40))).toBeNull();
  });

  it('agrees with frameCoordinates: any bearing at elevation 0 lands on the level line', () => {
    const c = cam(7.5, 50);
    const y = levelLineY(c, 16 / 9)!;
    for (const rel of [-20, -5, 0, 12, 24]) {
      const p = frameCoordinates(c, c.headingDeg + rel, 0, 16 / 9)!;
      expect(p.y).toBeCloseTo(y, 9);
    }
  });

  it('pitchForHorizonAt is the inverse of levelLineY for every placement', () => {
    for (const fov of [15, 40, 74, 97])
      for (const p of HORIZON_PLACEMENTS) {
        const pitch = pitchForHorizonAt(p.y, fov, 3 / 2);
        expect(levelLineY({ headingDeg: 0, pitchDeg: pitch, fovDeg: fov }, 3 / 2)!).toBeCloseTo(
          p.y,
          9,
        );
      }
    // Horizon on the low third means looking up; high third means looking down.
    expect(pitchForHorizonAt(-1 / 3, 60)).toBeGreaterThan(0);
    expect(pitchForHorizonAt(1 / 3, 60)).toBeLessThan(0);
    // And the frame centre then points at that elevation.
    const pitch = pitchForHorizonAt(-1 / 3, 60);
    expect(directionFromFrame(cam(pitch), 0, 0).elevationDeg).toBeCloseTo(pitch, 9);
  });

  it('a flat skyline at elevation 0 traces the level line edge to edge', () => {
    const c = cam(4, 60);
    const flat = { stepDeg: 3, elevationDeg: new Array<number>(120).fill(0) };
    const path = skylinePath(c, flat, 3 / 2);
    expect(path.length).toBeGreaterThan(40);
    expect(path[0]!.x).toBeLessThan(-1);
    expect(path.at(-1)!.x).toBeGreaterThan(1);
    const y = levelLineY(c, 3 / 2)!;
    for (const p of path) expect(p.y).toBeCloseTo(y, 9);
  });

  it('a ridge in the view raises the skyline only at its bearings', () => {
    const elevationDeg = new Array<number>(120).fill(0);
    // A 6° ridge from 117° to 123° (indices 39–41 at a 3° step).
    elevationDeg[39] = 6;
    elevationDeg[40] = 6;
    elevationDeg[41] = 6;
    const c = cam(0, 60, 120);
    const path = skylinePath(c, { stepDeg: 3, elevationDeg }, 3 / 2, 60);
    const centre = path.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a));
    const edge = path[0]!;
    expect(centre.y).toBeGreaterThan(0.15);
    expect(edge.y).toBeCloseTo(0, 9);
  });
});

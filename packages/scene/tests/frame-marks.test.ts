import { describe, expect, it } from 'vitest';
import { localSelectionToUtc } from '@lightmap/astronomy';
import {
  corePathInFrame,
  defaultCameraFeedFovDeg,
  edgeIndicator,
  moonPathInFrame,
  projectTrack,
  sampleTrack,
  sunPathInFrame,
  sunTrackPosition,
} from '../src/frame-marks.ts';
import { frameCoordinates } from '../src/camera.ts';

const kailua = { latitude: 21.397, longitude: -157.727 };
const at = (h: number, m = 0) =>
  localSelectionToUtc({ year: 2026, month: 5, day: 31 }, h * 60 + m, 'Pacific/Honolulu');

describe('sun path in the frame', () => {
  it('a west-facing frame at Kailua holds the evening sun and nothing from the morning', () => {
    const cam = { headingDeg: 285, pitchDeg: 10, fovDeg: 60 };
    const runs = sunPathInFrame(cam, kailua, at(5), at(20), { stepMinutes: 10, aspect: 4 / 3 });
    const all = runs.flat();
    expect(all.length).toBeGreaterThan(5);
    // Every sample is where frameCoordinates would put it, and inside the margin.
    for (const p of all) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1.3);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1.3);
    }
    const hours = all.map((p) => new Date(p.at).getUTCHours());
    // Evening in Honolulu is 03–06 UTC the next day; none of the samples are from the morning.
    for (const h of hours) expect(h >= 1 && h <= 6).toBe(true);
    // The path descends toward the horizon as the evening goes on.
    expect(all[0]!.y).toBeGreaterThan(all.at(-1)!.y);
  });
  it('a north-facing frame at Kailua in May sees no sun path at all', () => {
    const cam = { headingDeg: 0, pitchDeg: 5, fovDeg: 40 };
    expect(sunPathInFrame(cam, kailua, at(5), at(20), { aspect: 4 / 3 })).toEqual([]);
  });
  it('splits the path into runs when it leaves and re-enters the frame', () => {
    // Wide frame looking up: the sun crosses near the zenith at Kailua in late May.
    const cam = { headingDeg: 180, pitchDeg: 60, fovDeg: 90 };
    const runs = sunPathInFrame(cam, kailua, at(5), at(20), { stepMinutes: 5, aspect: 4 / 3 });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    for (const run of runs) expect(run.length).toBeGreaterThan(0);
  });
});

describe('moon path in the frame', () => {
  it('the full Moon of 31 May 2026 rises into an east-facing frame at Kailua in the evening', () => {
    const cam = { headingDeg: 110, pitchDeg: 20, fovDeg: 90 };
    const runs = moonPathInFrame(cam, kailua, at(17), at(23, 59), {
      stepMinutes: 10,
      aspect: 4 / 3,
    });
    const all = runs.flat();
    expect(all.length).toBeGreaterThan(5);
    // Nothing before moonrise (~19:3x HST = 05:3x UTC on 1 June); the Moon climbs (y grows).
    for (const p of all) expect(p.at.getTime()).toBeGreaterThan(Date.parse('2026-06-01T05:00:00Z'));
    expect(all.at(-1)!.y).toBeGreaterThan(all[0]!.y);
    // Facing west there is no Moon path that evening.
    expect(moonPathInFrame({ ...cam, headingDeg: 270 }, kailua, at(17), at(23, 59))).toEqual([]);
  });
  it('sampling and projection compose to the same path as the one-shot helper', () => {
    const cam = { headingDeg: 285, pitchDeg: 10, fovDeg: 60 };
    const samples = sampleTrack(at(5), at(20), sunTrackPosition(kailua), 10);
    expect(samples).toHaveLength(91);
    expect(projectTrack(cam, samples, { aspect: 4 / 3 })).toEqual(
      sunPathInFrame(cam, kailua, at(5), at(20), { stepMinutes: 10, aspect: 4 / 3 }),
    );
  });
});

describe('core track in the frame', () => {
  it('a south-facing frame at Kailua on the new-Moon night holds the core from dusk to dawn', () => {
    const cam = { headingDeg: 180, pitchDeg: 25, fovDeg: 70 };
    const night = { year: 2026, month: 6, day: 15 };
    const from = localSelectionToUtc(night, 20 * 60, 'Pacific/Honolulu');
    const to = localSelectionToUtc({ ...night, day: 16 }, 5 * 60, 'Pacific/Honolulu');
    const runs = corePathInFrame(cam, kailua, from, to, { stepMinutes: 10, aspect: 4 / 3 });
    const all = runs.flat();
    expect(all.length).toBeGreaterThan(20);
    // Nothing before astronomical dusk (~20:40 HST = 06:40 UTC) or after dawn (~04:23 = 14:23 UTC).
    for (const p of all) {
      const ms = p.at.getTime();
      expect(ms).toBeGreaterThanOrEqual(Date.parse('2026-06-16T06:35:00Z'));
      expect(ms).toBeLessThanOrEqual(Date.parse('2026-06-16T14:30:00Z'));
    }
    // The track rises to its transit (highest point, largest y) and sets again: not monotonic.
    const ys = all.map((p) => p.y);
    const topAt = ys.indexOf(Math.max(...ys));
    expect(topAt).toBeGreaterThan(0);
    expect(topAt).toBeLessThan(ys.length - 1);
  });
  it('by day there is no track, and none facing north from Kailua', () => {
    const cam = { headingDeg: 180, pitchDeg: 25, fovDeg: 70 };
    expect(corePathInFrame(cam, kailua, at(8), at(16), { aspect: 4 / 3 })).toEqual([]);
    const north = { headingDeg: 0, pitchDeg: 25, fovDeg: 60 };
    const from = localSelectionToUtc(
      { year: 2026, month: 6, day: 15 },
      20 * 60,
      'Pacific/Honolulu',
    );
    const to = localSelectionToUtc({ year: 2026, month: 6, day: 16 }, 5 * 60, 'Pacific/Honolulu');
    expect(corePathInFrame(north, kailua, from, to, { aspect: 4 / 3 })).toEqual([]);
  });
});

describe('edge indicator', () => {
  const cam = { headingDeg: 90, pitchDeg: 0, fovDeg: 60 };
  it('is null while the body is in the frame', () => {
    expect(edgeIndicator(cam, 95, 10, 4 / 3)).toBeNull();
  });
  it('points right for a body to the right, up for one above, and lands on the frame edge', () => {
    const right = edgeIndicator(cam, 150, 5, 4 / 3)!;
    expect(right.x).toBeCloseTo(1, 9);
    expect(right.angleDeg).toBeGreaterThan(45);
    expect(right.angleDeg).toBeLessThan(135);
    expect(right.turnRightDeg).toBeCloseTo(60, 9);
    const above = edgeIndicator(cam, 90, 70, 4 / 3)!;
    expect(above.y).toBeCloseTo(1, 9);
    expect(above.angleDeg).toBeCloseTo(0, 6);
    expect(above.tiltUpDeg).toBeCloseTo(70, 9);
    const left = edgeIndicator(cam, 20, 0, 4 / 3)!;
    expect(left.x).toBeCloseTo(-1, 9);
    expect(left.turnRightDeg).toBeCloseTo(-70, 9);
  });
  it('a body behind the camera still gets a sideways arrow toward the shorter turn', () => {
    const behind = edgeIndicator(cam, 250, 10, 4 / 3)!; // 160° to the right = 200° to the left
    expect(behind.turnRightDeg).toBeCloseTo(160, 9);
    expect(behind.x).toBeCloseTo(1, 9);
  });
  it('agrees with frameCoordinates on what counts as inside', () => {
    for (const az of [60, 75, 105, 120])
      for (const el of [-20, 0, 25]) {
        const f = frameCoordinates(cam, az, el, 4 / 3);
        const inside = f !== null && Math.abs(f.x) <= 1 && Math.abs(f.y) <= 1;
        expect(edgeIndicator(cam, az, el, 4 / 3) === null).toBe(inside);
      }
  });
});

describe('camera feed FOV default', () => {
  it('69° across a landscape feed, about 54° across a 4:3 portrait feed, 55° when unknown', () => {
    expect(defaultCameraFeedFovDeg(1920, 1080)).toBe(69);
    expect(defaultCameraFeedFovDeg(1080, 1440)).toBeCloseTo(54.6, 0);
    expect(defaultCameraFeedFovDeg(0, 0)).toBe(55);
  });
});

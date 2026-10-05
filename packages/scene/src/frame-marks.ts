/**
 * Marks for a camera frame (Phase 9 field view, "AR sun alignment"): where the sun's path for the
 * day (or the Milky Way core's track for the night) crosses the frame, and where to point an edge
 * arrow when a body is outside it. Pure frame
 * maths on top of `frameCoordinates`; the field view draws the results over the live camera feed.
 */
import {
  galacticCentrePosition,
  moonHorizonThresholdDeg,
  moonPosition,
  sunPosition,
} from '@lightmap/astronomy';
import type { CameraState } from './types.ts';
import { frameCoordinates, relativeBearing } from './camera.ts';

type FrameCamera = Pick<CameraState, 'headingDeg' | 'pitchDeg' | 'fovDeg'>;

export interface FramePathPoint {
  x: number;
  y: number;
  /** Instant of the sample, UTC. */
  at: Date;
}

export interface PathOptions {
  stepMinutes?: number;
  aspect?: number;
  frameMargin?: number;
  rollDeg?: number;
}

/** A sampled sky position of a body: what the frame projection consumes. */
export interface TrackSample {
  at: Date;
  azimuthDeg: number;
  elevationDeg: number;
}

/**
 * Sample a body's position every `stepMinutes` between two instants; `positionAt` returns null
 * where the body is not to be drawn (below the horizon, daylight for the core). Pure astronomy,
 * no camera: callers memoise this per place and day and project it per frame.
 */
export function sampleTrack(
  start: Date,
  end: Date,
  positionAt: (at: Date) => { azimuthDeg: number; elevationDeg: number } | null,
  stepMinutes = 10,
): TrackSample[] {
  const step = Math.max(1, stepMinutes) * 60_000;
  const out: TrackSample[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    const at = new Date(t);
    const p = positionAt(at);
    out.push(
      p
        ? { at, azimuthDeg: p.azimuthDeg, elevationDeg: p.elevationDeg }
        : { at, azimuthDeg: Number.NaN, elevationDeg: Number.NaN },
    );
  }
  return out;
}

/**
 * Project sampled positions into frame coordinates as a polyline. Samples behind the camera,
 * outside the frame or not drawn (NaN) break the line, so the result may be several runs;
 * `frameMargin` keeps a little of the path past the edges so it reads as continuous.
 */
export function projectTrack(
  camera: FrameCamera,
  samples: readonly TrackSample[],
  opts: Omit<PathOptions, 'stepMinutes'> = {},
): FramePathPoint[][] {
  const aspect = opts.aspect ?? 3 / 2;
  const margin = opts.frameMargin ?? 0.3;
  const roll = opts.rollDeg ?? 0;
  const runs: FramePathPoint[][] = [];
  let run: FramePathPoint[] = [];
  for (const s of samples) {
    const f = Number.isFinite(s.elevationDeg)
      ? frameCoordinates(camera, s.azimuthDeg, s.elevationDeg, aspect, roll)
      : null;
    if (f && Math.abs(f.x) <= 1 + margin && Math.abs(f.y) <= 1 + margin) {
      run.push({ x: f.x, y: f.y, at: s.at });
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/**
 * A body's path between two instants as a polyline in frame coordinates, sampled every
 * `stepMinutes` from `positionAt` (null = not drawn at that instant).
 */
export function bodyPathInFrame(
  camera: FrameCamera,
  start: Date,
  end: Date,
  positionAt: (at: Date) => { azimuthDeg: number; elevationDeg: number } | null,
  opts: PathOptions = {},
): FramePathPoint[][] {
  return projectTrack(camera, sampleTrack(start, end, positionAt, opts.stepMinutes), opts);
}

/** The sun where it is drawn: apparent elevation, dropped below −1°. */
export function sunTrackPosition(point: {
  latitude: number;
  longitude: number;
}): (at: Date) => { azimuthDeg: number; elevationDeg: number } | null {
  return (at) => {
    const p = sunPosition(at, point.latitude, point.longitude);
    return p.elevationDeg >= -1
      ? { azimuthDeg: p.azimuthDeg, elevationDeg: p.apparentElevationDeg }
      : null;
  };
}

/** The Moon where it is drawn: topocentric elevation, while above its rise/set threshold. */
export function moonTrackPosition(point: {
  latitude: number;
  longitude: number;
}): (at: Date) => { azimuthDeg: number; elevationDeg: number } | null {
  return (at) => {
    const m = moonPosition(at, point.latitude, point.longitude);
    return m.elevationDeg > moonHorizonThresholdDeg(m.distanceKm)
      ? { azimuthDeg: m.azimuthDeg, elevationDeg: m.elevationDeg }
      : null;
  };
}

/**
 * The Milky Way core where it is drawn (night planning): the Galactic Centre while the Sun is
 * below −18° and the core above the horizon — where the band stands through the dark hours, for
 * composing before it rises. Not a visibility verdict (the Moon is not consulted).
 */
export function coreTrackPosition(point: {
  latitude: number;
  longitude: number;
}): (at: Date) => { azimuthDeg: number; elevationDeg: number } | null {
  return (at) => {
    if (sunPosition(at, point.latitude, point.longitude).elevationDeg > -18) return null;
    const c = galacticCentrePosition(at, point.latitude, point.longitude);
    return c.elevationDeg > 0 ? { azimuthDeg: c.azimuthDeg, elevationDeg: c.elevationDeg } : null;
  };
}

/** The sun's path between two instants (apparent elevation, so the marker sits on it). */
export function sunPathInFrame(
  camera: FrameCamera,
  point: { latitude: number; longitude: number },
  start: Date,
  end: Date,
  opts: PathOptions = {},
): FramePathPoint[][] {
  return bodyPathInFrame(camera, start, end, sunTrackPosition(point), opts);
}

/** The Moon's path between two instants while it is up. */
export function moonPathInFrame(
  camera: FrameCamera,
  point: { latitude: number; longitude: number },
  start: Date,
  end: Date,
  opts: PathOptions = {},
): FramePathPoint[][] {
  return bodyPathInFrame(camera, start, end, moonTrackPosition(point), opts);
}

/** The Milky Way core's track over the night (see `coreTrackPosition`). */
export function corePathInFrame(
  camera: FrameCamera,
  point: { latitude: number; longitude: number },
  start: Date,
  end: Date,
  opts: PathOptions = {},
): FramePathPoint[][] {
  return bodyPathInFrame(camera, start, end, coreTrackPosition(point), opts);
}

export interface EdgeIndicator {
  /** Point on the frame edge (−1…1 coordinates), where the arrow sits. */
  x: number;
  y: number;
  /** Direction to turn, degrees clockwise from "up" in the frame (0 = up, 90 = right). */
  angleDeg: number;
  /** How far to turn horizontally (signed, degrees; positive = right) and vertically (positive = up). */
  turnRightDeg: number;
  tiltUpDeg: number;
}

/**
 * Where a body outside the frame is: a point on the frame edge and the turn that brings it in.
 * `null` when the body is already inside the frame. Works for bodies behind the camera too
 * (the arrow then points sideways, toward the shorter turn).
 */
export function edgeIndicator(
  camera: FrameCamera,
  azimuthDeg: number,
  elevationDeg: number,
  aspect = 3 / 2,
  rollDeg = 0,
): EdgeIndicator | null {
  const f = frameCoordinates(camera, azimuthDeg, elevationDeg, aspect, rollDeg);
  if (f && Math.abs(f.x) <= 1 && Math.abs(f.y) <= 1) return null;
  const turnRightDeg = relativeBearing(camera.headingDeg, azimuthDeg);
  const tiltUpDeg = elevationDeg - camera.pitchDeg;
  // Direction in the frame: horizontal turn → x, vertical → y, scaled by the frame's half-angles
  // so a body just past a short edge points at that edge.
  const DEG = Math.PI / 180;
  const halfW = camera.fovDeg / 2;
  const halfH = Math.atan(Math.tan(halfW * DEG) / aspect) / DEG;
  let dx = turnRightDeg / halfW;
  let dy = tiltUpDeg / halfH;
  if (rollDeg) {
    // The arrow lives in the (rolled) frame: turn the world direction with the roll.
    const r = rollDeg * DEG;
    const c = Math.cos(r);
    const s = Math.sin(r);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
  }
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) dx = 1;
  const k = 1 / Math.max(Math.abs(dx), Math.abs(dy));
  dx *= k;
  dy *= k;
  const angleDeg = (((Math.atan2(dx, dy) / DEG) % 360) + 360) % 360;
  return { x: dx, y: dy, angleDeg, turnRightDeg, tiltUpDeg };
}

/**
 * A sensible horizontal field of view for a phone's main camera feed, by the feed's orientation:
 * ≈ 26 mm-equivalent glass sees ≈ 69° across its long side, so a portrait feed shows the short
 * side, ≈ 54° for 4:3. Photographers can nudge it in the field view to match what they see.
 */
export function defaultCameraFeedFovDeg(videoWidth: number, videoHeight: number): number {
  if (!(videoWidth > 0) || !(videoHeight > 0)) return 55;
  const DEG = Math.PI / 180;
  const longSideFov = 69;
  if (videoWidth >= videoHeight) return longSideFov;
  const ratio = videoWidth / videoHeight;
  return (2 * Math.atan(Math.tan((longSideFov / 2) * DEG) * ratio)) / DEG;
}

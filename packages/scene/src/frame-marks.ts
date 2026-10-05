/**
 * Marks for a camera frame (Phase 9 field view, "AR sun alignment"): where the sun's path for the
 * day crosses the frame, and where to point an edge arrow when a body is outside it. Pure frame
 * maths on top of `frameCoordinates`; the field view draws the results over the live camera feed.
 */
import { sunPosition } from '@lightmap/astronomy';
import type { CameraState } from './types.ts';
import { frameCoordinates, relativeBearing } from './camera.ts';

type FrameCamera = Pick<CameraState, 'headingDeg' | 'pitchDeg' | 'fovDeg'>;

export interface FramePathPoint {
  x: number;
  y: number;
  /** Instant of the sample, UTC. */
  at: Date;
}

/**
 * The sun's path between two instants as a polyline in frame coordinates, sampled every
 * `stepMinutes`. Samples below the horizon or behind the camera are dropped, so the result may be
 * several runs; `frameMargin` keeps a little of the path past the edges so it reads as continuous.
 */
export function sunPathInFrame(
  camera: FrameCamera,
  point: { latitude: number; longitude: number },
  start: Date,
  end: Date,
  opts: { stepMinutes?: number; aspect?: number; frameMargin?: number } = {},
): FramePathPoint[][] {
  const step = Math.max(1, opts.stepMinutes ?? 10) * 60_000;
  const aspect = opts.aspect ?? 3 / 2;
  const margin = opts.frameMargin ?? 0.3;
  const runs: FramePathPoint[][] = [];
  let run: FramePathPoint[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    const at = new Date(t);
    const p = sunPosition(at, point.latitude, point.longitude);
    const f =
      p.elevationDeg >= -1
        ? frameCoordinates(camera, p.azimuthDeg, p.apparentElevationDeg, aspect)
        : null;
    if (f && Math.abs(f.x) <= 1 + margin && Math.abs(f.y) <= 1 + margin) {
      run.push({ x: f.x, y: f.y, at });
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
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
): EdgeIndicator | null {
  const f = frameCoordinates(camera, azimuthDeg, elevationDeg, aspect);
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

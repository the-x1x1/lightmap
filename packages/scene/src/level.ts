/**
 * Horizon levelling (Phase 6): where true level and the modelled skyline cross the viewpoint
 * frame, and the pitch that puts the horizon on a chosen line (centre, or a rule-of-thirds line).
 *
 * The frame uses the same rectilinear projection as `frameCoordinates` (x −1…1 left→right,
 * y −1…1 bottom→top). The camera has no roll, so true level (elevation 0, a great circle) is a
 * straight horizontal line: y = −tan(pitch) / tan(halfHeight).
 */
import type { CameraState } from './types.ts';
import { frameCoordinates } from './camera.ts';
import { horizonElevationAt, type HorizonProfile } from './horizon.ts';

const DEG = Math.PI / 180;

type FrameCamera = Pick<CameraState, 'headingDeg' | 'pitchDeg' | 'fovDeg'>;

function halfHeightTan(fovDeg: number, aspect: number): number {
  return Math.tan((fovDeg * DEG) / 2) / aspect;
}

/** Frame y of true level (elevation 0) — null when level is outside the frame. */
export function levelLineY(camera: FrameCamera, aspect = 3 / 2): number | null {
  const y = -Math.tan(camera.pitchDeg * DEG) / halfHeightTan(camera.fovDeg, aspect);
  if (Math.abs(y) > 1) return null;
  return y === 0 ? 0 : y; // no -0 at zero pitch
}

/** The pitch (degrees) that puts true level at frame height `y` (−1 bottom … +1 top). */
export function pitchForHorizonAt(y: number, fovDeg: number, aspect = 3 / 2): number {
  return Math.atan(-y * halfHeightTan(fovDeg, aspect)) / DEG;
}

/** Composition targets for the horizon: centre, or on a rule-of-thirds line. */
export const HORIZON_PLACEMENTS = [
  { id: 'low-third', label: 'Low third', y: -1 / 3 },
  { id: 'centre', label: 'Level', y: 0 },
  { id: 'high-third', label: 'High third', y: 1 / 3 },
] as const;
export type HorizonPlacementId = (typeof HORIZON_PLACEMENTS)[number]['id'];

/**
 * The modelled terrain skyline across the frame as a polyline (frame coordinates), sampled at
 * `steps + 1` bearings from the left edge to the right edge. Points behind the camera are
 * dropped; y is left unclamped so the line runs off the top or bottom edge naturally.
 */
export function skylinePath(
  camera: FrameCamera,
  profile: Pick<HorizonProfile, 'stepDeg' | 'elevationDeg'>,
  aspect = 3 / 2,
  steps = 48,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  // Sweep a little past the edges in bearing so the line reaches both sides of the frame.
  const half = Math.min(89, camera.fovDeg / 2 + 2);
  for (let i = 0; i <= steps; i++) {
    const rel = -half + (2 * half * i) / steps;
    const az = (((camera.headingDeg + rel) % 360) + 360) % 360;
    const p = frameCoordinates(camera, az, horizonElevationAt(profile, az), aspect);
    if (p && Math.abs(p.x) <= 1.2) out.push(p);
  }
  return out;
}

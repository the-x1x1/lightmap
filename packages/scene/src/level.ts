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

/**
 * True level as a segment across the frame for a rolled camera (positive roll = right edge
 * down, so the line rises to the right). Endpoints in frame coordinates at x = −1 and x = +1;
 * null when level misses the frame entirely. With no roll this is the horizontal line at
 * `levelLineY`.
 */
export function levelLineSegment(
  camera: FrameCamera,
  aspect = 3 / 2,
  rollDeg = 0,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const DEG = Math.PI / 180;
  const halfW = Math.tan((camera.fovDeg * DEG) / 2);
  const halfH = halfW / aspect;
  // In the tangent plane level is the line ty = −tan(pitch) before roll; rolling by θ maps
  // (tx, ty) → (tx·c − ty·s, tx·s + ty·c), so the line keeps direction (c, s) through (0, −tan p)·R.
  const t0 = -Math.tan(camera.pitchDeg * DEG);
  const r = rollDeg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const px = -t0 * s; // the point (0, t0) after roll
  const py = t0 * c;
  if (Math.abs(c) < 1e-9) return null; // vertical level line: a 90° roll; not drawn
  // Parametrise by tx: ty = py + (tx − px)·(s / c); evaluate at the frame's left/right edges.
  const slope = s / c;
  const yAt = (tx: number) => (py + (tx - px) * slope) / halfH;
  const y1 = yAt(-halfW);
  const y2 = yAt(halfW);
  if ((y1 < -1 && y2 < -1) || (y1 > 1 && y2 > 1)) return null;
  return { x1: -1, y1, x2: 1, y2 };
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
  rollDeg = 0,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  // Sweep a little past the edges in bearing so the line reaches both sides of the frame.
  const half = Math.min(89, camera.fovDeg / 2 + 2);
  for (let i = 0; i <= steps; i++) {
    const rel = -half + (2 * half * i) / steps;
    const az = (((camera.headingDeg + rel) % 360) + 360) % 360;
    const p = frameCoordinates(camera, az, horizonElevationAt(profile, az), aspect, rollDeg);
    if (p && Math.abs(p.x) <= 1.2) out.push(p);
  }
  return out;
}

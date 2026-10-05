/**
 * Device orientation → camera (roadmap Phase 9 "compass, device orientation, field mode"): hold
 * the phone like a camera and the viewpoint camera follows where its back camera points.
 *
 * Pure maths on the W3C DeviceOrientation angles. The device frame is fixed to the phone in its
 * natural (portrait) orientation — x to the right, y to the top, z out of the screen — whatever
 * the screen rotation, so heading and pitch need no screen-orientation fix-up; roll is about the
 * device's own axes, so a consumer drawing on the (rotated) screen adds the screen angle. The
 * rotation from Earth frame
 * (x East, y North, z Up) to device frame is Rz(alpha) · Rx(beta) · Ry(gamma); the back camera
 * looks along the device's −z.
 */
import { normalizeHeading } from './camera.ts';

const DEG = Math.PI / 180;

export interface OrientationAngles {
  /** Rotation about z, 0–360, counter-clockwise from north when `absolute` (W3C). */
  alpha: number;
  /** Rotation about x, −180–180: 90 = upright portrait. */
  beta: number;
  /** Rotation about y, −90–90. */
  gamma: number;
  /** iOS only: compass heading of the device's top, clockwise, 0–360. */
  webkitCompassHeading?: number | null;
  /** Whether alpha is relative to north (true) or to an arbitrary start (false/undefined). */
  absolute?: boolean | null;
}

export interface CameraPointing {
  /** Compass bearing the back camera points at, 0–360. */
  headingDeg: number;
  /** Elevation of the back camera's line of sight, −90–90 (0 = level). */
  pitchDeg: number;
  /**
   * Roll about the line of sight, degrees, positive when the phone's right edge is lower than
   * its left (clockwise seen from behind the camera); 0 when the device's top-bottom axis is
   * upright in portrait, ±90 in landscape. −180–180.
   */
  rollDeg: number;
}

/**
 * Where the back camera points. `null` when the angles cannot give a compass heading (no
 * absolute reference and no iOS compass heading) or are not finite.
 */
export function cameraPointingFromOrientation(o: OrientationAngles): CameraPointing | null {
  let alpha = o.alpha;
  if (typeof o.webkitCompassHeading === 'number' && Number.isFinite(o.webkitCompassHeading)) {
    // iOS: alpha is relative to the first reading; the compass heading is the device top's bearing.
    alpha = 360 - o.webkitCompassHeading;
  } else if (o.absolute === false) {
    return null;
  }
  if (![alpha, o.beta, o.gamma].every((v) => typeof v === 'number' && Number.isFinite(v)))
    return null;
  const a = alpha * DEG;
  const b = o.beta * DEG;
  const g = o.gamma * DEG;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);
  // Third column of R = Rz(a)·Rx(b)·Ry(g) is the device z axis in Earth frame; the camera is −z.
  const zx = ca * sg + sa * sb * cg;
  const zy = sa * sg - ca * sb * cg;
  const zz = cb * cg;
  const east = -zx;
  const north = -zy;
  const up = -zz;
  const headingDeg = normalizeHeading(Math.atan2(east, north) / DEG);
  const pitchDeg = Math.asin(Math.max(-1, Math.min(1, up))) / DEG;
  // Roll: compare the device's right (x) and top (y) axes against the vertical. Their z
  // components (first/second column of R, third row) are sb·… and cb·… terms:
  const xz = -cb * sg; // z component of the device x axis in Earth frame
  const yz = sb; // z component of the device y axis
  const rollDeg = Math.atan2(-xz, yz) / DEG;
  return { headingDeg, pitchDeg, rollDeg };
}

/**
 * Smooth a heading series without the 359→0 jump: move `weight` (0–1) of the way from the
 * previous heading to the next along the shorter arc. (A vector average would stall on a 180°
 * turn — the two unit vectors cancel — so the blend is done on the angle itself.)
 */
export function blendHeading(previousDeg: number, nextDeg: number, weight: number): number {
  const w = Math.max(0, Math.min(1, weight));
  let d = (((nextDeg - previousDeg) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  if (Math.abs(Math.abs(d) - 180) < 1e-9) return normalizeHeading(nextDeg); // opposite: take the new one
  return normalizeHeading(previousDeg + w * d);
}

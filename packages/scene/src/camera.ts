/**
 * Camera / viewpoint model (plan §5). A location is not enough to describe a photograph.
 */
import type { CameraState } from './types.ts';
import type { GeoPoint } from '@lightmap/geospatial';

/** Full-frame equivalent presets. */
export const FOCAL_LENGTH_PRESETS_MM = [16, 24, 35, 50, 85, 135] as const;
export type FocalLengthPreset = (typeof FOCAL_LENGTH_PRESETS_MM)[number];

/** Horizontal FOV of a full-frame (36 mm wide) sensor for a focal length. */
export function horizontalFovDeg(focalLengthMm: number, sensorWidthMm = 36): number {
  return (2 * Math.atan(sensorWidthMm / (2 * focalLengthMm)) * 180) / Math.PI;
}

export function focalLengthForFov(fovDeg: number, sensorWidthMm = 36): number {
  return sensorWidthMm / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

export const DEFAULT_EYE_HEIGHT_M = 1.7;

export function defaultCamera(eye: GeoPoint, headingDeg = 0): CameraState {
  return {
    eye,
    eyeHeightM: DEFAULT_EYE_HEIGHT_M,
    headingDeg,
    pitchDeg: 0,
    fovDeg: horizontalFovDeg(24),
    focalLengthMm: 24,
    mode: 'map',
  };
}

export function normalizeHeading(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

export function clampPitch(deg: number, min = -89, max = 89): number {
  return Math.max(min, Math.min(max, deg));
}

/** Angle from camera heading to a target azimuth, in [-180, 180). Negative = target is to the left. */
export function relativeBearing(headingDeg: number, targetAzimuthDeg: number): number {
  let d = normalizeHeading(targetAzimuthDeg) - normalizeHeading(headingDeg);
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Is a direction (e.g. the Sun) inside the horizontal field of view? */
export function isInFrame(camera: Pick<CameraState, 'headingDeg' | 'fovDeg'>, azimuthDeg: number): boolean {
  return Math.abs(relativeBearing(camera.headingDeg, azimuthDeg)) <= camera.fovDeg / 2;
}

/**
 * Where the Sun (or Moon) sits in the frame, as normalised coordinates: x from −1 (left edge) to
 * +1 (right edge), y from −1 (bottom) to +1 (top), using a rectilinear projection and the given
 * aspect ratio. Null when it is behind the camera. This is the building block for reverse
 * planning (plan §26): "I want the sun here in frame".
 */
export function frameCoordinates(camera: Pick<CameraState, 'headingDeg' | 'pitchDeg' | 'fovDeg'>, azimuthDeg: number, elevationDeg: number, aspect = 3 / 2): { x: number; y: number } | null {
  const DEG = Math.PI / 180;
  const rel = relativeBearing(camera.headingDeg, azimuthDeg) * DEG;
  const el = elevationDeg * DEG;
  // Direction in camera-forward frame (forward = +z, right = +x, up = +y) before pitch.
  const dx = Math.cos(el) * Math.sin(rel);
  const dy = Math.sin(el);
  const dz = Math.cos(el) * Math.cos(rel);
  // Rotate by pitch about the x axis.
  const p = camera.pitchDeg * DEG;
  const y2 = dy * Math.cos(p) - dz * Math.sin(p);
  const z2 = dy * Math.sin(p) + dz * Math.cos(p);
  if (z2 <= 1e-6) return null;
  const halfW = Math.tan((camera.fovDeg * DEG) / 2);
  const halfH = halfW / aspect;
  return { x: dx / z2 / halfW, y: y2 / z2 / halfH };
}

/** Lighting geometry relative to the camera, in photographer's terms. */
export type LightingGeometry = 'front-lit' | 'side-lit' | 'back-lit' | 'top-lit' | 'below-horizon';

export function lightingGeometry(camera: Pick<CameraState, 'headingDeg'>, sunAzimuthDeg: number, sunElevationDeg: number): LightingGeometry {
  if (sunElevationDeg < -0.833) return 'below-horizon';
  if (sunElevationDeg > 70) return 'top-lit';
  const rel = Math.abs(relativeBearing(camera.headingDeg, sunAzimuthDeg));
  if (rel <= 45) return 'back-lit'; // sun in front of the camera lights the subject from behind
  if (rel >= 135) return 'front-lit';
  return 'side-lit';
}

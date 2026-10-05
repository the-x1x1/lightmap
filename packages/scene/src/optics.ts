/**
 * Depth of field (Phase 6 "DOF"). Thin-lens geometry for the photographer's own lens and
 * sensor — no rendering: the preview stays pin-sharp, these numbers tell you what the photo will
 * hold in focus. Distances are measured from the lens (thin-lens convention), in metres; lens figures in
 * millimetres.
 *
 * Circle of confusion follows the usual print-viewing convention: the sensor diagonal / 1500
 * (full frame ≈ 0.029 mm). It is a convention, not physics, so the UI says so.
 */

/** Full stops plus the common half-stop f/1.8 and f/3.5 marks lenses carry. */
export const APERTURE_STOPS = [1.4, 1.8, 2, 2.8, 3.5, 4, 5.6, 8, 11, 16, 22] as const;

/** Diagonal / 1500, from width and height in mm. Height defaults to a 3:2 frame. */
export function circleOfConfusionMm(sensorWidthMm: number, sensorHeightMm?: number): number {
  const h = sensorHeightMm ?? (sensorWidthMm * 2) / 3;
  return Math.hypot(sensorWidthMm, h) / 1500;
}

/** Hyperfocal distance in metres: focus here and everything from half of it to infinity is acceptably sharp. */
export function hyperfocalDistanceM(
  focalLengthMm: number,
  aperture: number,
  cocMm: number,
): number {
  return ((focalLengthMm * focalLengthMm) / (aperture * cocMm) + focalLengthMm) / 1000;
}

export interface DepthOfField {
  /** Nearest acceptably sharp distance, metres. */
  nearM: number;
  /** Farthest acceptably sharp distance, metres; `Infinity` when the far limit reaches infinity. */
  farM: number;
  /** far − near; `Infinity` with the far limit. */
  totalM: number;
  hyperfocalM: number;
  /** The sun, moon and horizon are inside the zone of focus. */
  infinitySharp: boolean;
  /** Share of the zone in front of the focus distance (0–1); `null` when the zone is infinite. */
  frontShare: number | null;
}

/**
 * Near and far limits of acceptable sharpness for a lens focused at `focusDistanceM`.
 * `focalLengthMm` is the real focal length printed on the lens (not the full-frame equivalent):
 * depth of field depends on the actual glass and the sensor's circle of confusion.
 */
export function depthOfField(opts: {
  focalLengthMm: number;
  aperture: number;
  focusDistanceM: number;
  cocMm: number;
}): DepthOfField {
  const f = opts.focalLengthMm;
  const H = hyperfocalDistanceM(f, opts.aperture, opts.cocMm) * 1000; // mm
  // Focusing closer than the focal length is not a real focus distance; clamp just past it.
  const s = Math.max(opts.focusDistanceM * 1000, f * 1.001);
  const near = (s * (H - f)) / (H + s - 2 * f);
  const far = s >= H ? Infinity : (s * (H - f)) / (H - s);
  const nearM = near / 1000;
  const farM = far / 1000;
  return {
    nearM,
    farM,
    totalM: farM - nearM,
    hyperfocalM: H / 1000,
    infinitySharp: farM === Infinity,
    frontShare: farM === Infinity ? null : (s / 1000 - nearM) / (farM - nearM),
  };
}

/** "3.4 m", "85 cm", "12 m", "1.2 km", "∞" — compact for a panel row. */
export function formatDistanceM(m: number): string {
  if (!Number.isFinite(m)) return '∞';
  if (m < 1) return `${Math.round(m * 100)} cm`;
  if (m < 10) return `${m.toFixed(1)} m`;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

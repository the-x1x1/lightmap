/**
 * Camera altitude ↔ web-mercator zoom, heading normalisation and framing math.
 *
 * Provenance: ported from the owner's WorldView repository — `render-cesium/src/view.ts`
 * (`normalizeHeadingDegrees`, `altitudeForBounds`) and `render-core/src/contract.ts`
 * (`zoomToAltitudeM`, `altitudeToZoom`), owner-authored, MIT — and rewritten against LightMap's
 * `CameraState`. See docs/WORLDVIEW_REUSE_AUDIT.md row 2.
 */
import type { GeoBounds } from '@lightmap/geospatial';

const DEG = Math.PI / 180;
/** Web-Mercator metres per pixel at zoom 0 for 256 px tiles. */
const MPP_Z0 = 156_543.033_92;
/** Half of a ~60° vertical field of view; the framing assumption both conversions share. */
const HALF_FOV_TAN = Math.tan(Math.PI / 6);

export function normalizeHeadingDegrees(h: number): number {
  const x = h % 360;
  return x < 0 ? x + 360 : x;
}

/** Camera height above the ellipsoid that shows the same ground extent as a 2D map at `zoom`. */
export function zoomToAltitudeM(zoom: number, latitude = 0, viewportPx = 1024): number {
  const metersPerPixel = (MPP_Z0 * Math.cos(latitude * DEG)) / Math.pow(2, zoom);
  return Math.max(10, (metersPerPixel * (viewportPx / 2)) / HALF_FOV_TAN);
}

export function altitudeToZoom(altitudeM: number, latitude = 0, viewportPx = 1024): number {
  const metersPerPixel = (altitudeM * HALF_FOV_TAN) / (viewportPx / 2);
  const z = Math.log2((MPP_Z0 * Math.cos(latitude * DEG)) / metersPerPixel);
  return Math.max(0, Math.min(22, z));
}

/** Camera altitude that frames `bounds` in a ~60° FOV viewport (square worst case, 15 % margin). */
export function altitudeForBounds(bounds: GeoBounds, minAltitudeM = 500): number {
  const latSpanM = Math.abs(bounds.north - bounds.south) * 111_320;
  const midLat = (bounds.north + bounds.south) / 2;
  const lonSpan =
    bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
  const lonSpanM = lonSpan * 111_320 * Math.cos(midLat * DEG);
  const halfSpan = Math.max(latSpanM, lonSpanM) / 2;
  return Math.max(minAltitudeM, (halfSpan / HALF_FOV_TAN) * 1.15);
}

/**
 * Orbit camera for "map" mode: look at the pin from a distance, tilted. Returns the Cesium
 * `lookAt` offset as heading/pitch/range so the pin stays centred while the user orbits.
 */
export interface OrbitView {
  headingDeg: number;
  /** Negative looks down. */
  pitchDeg: number;
  rangeM: number;
}

export function defaultOrbit(rangeM = 1500): OrbitView {
  return { headingDeg: 0, pitchDeg: -35, rangeM };
}

export function clampOrbit(v: OrbitView, minRange = 50, maxRange = 5_000_000): OrbitView {
  return {
    headingDeg: normalizeHeadingDegrees(v.headingDeg),
    pitchDeg: Math.max(-89, Math.min(-5, v.pitchDeg)),
    rangeM: Math.max(minRange, Math.min(maxRange, v.rangeM)),
  };
}

/**
 * Points along the sight line from an orbit camera to its target, for a terrain-clearance check:
 * `samples` points from the camera end (t = 1) toward the target (excluded), as latitude,
 * longitude and height above the ellipsoid (a local flat-earth step, fine over the few
 * kilometres an orbit spans). Heading clockwise from north, pitch negative looking down —
 * Cesium's HeadingPitchRange convention, the camera standing back along the view direction.
 */
export function orbitSightLine(
  target: { latitude: number; longitude: number; heightM: number },
  headingDeg: number,
  pitchDeg: number,
  rangeM: number,
  samples = 6,
): Array<{ latitude: number; longitude: number; heightM: number }> {
  const h = (headingDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const east = -rangeM * Math.cos(p) * Math.sin(h);
  const north = -rangeM * Math.cos(p) * Math.cos(h);
  const up = -rangeM * Math.sin(p);
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.max(0.01, Math.cos((target.latitude * Math.PI) / 180));
  const out = [];
  for (let i = samples; i >= 1; i--) {
    const t = i / samples;
    out.push({
      latitude: target.latitude + (north * t) / mPerDegLat,
      longitude: target.longitude + (east * t) / mPerDegLon,
      heightM: target.heightM + up * t,
    });
  }
  return out;
}

/**
 * The orbit pitch that keeps the camera and its sight line clear of the ground: the requested
 * pitch if it clears, otherwise the first of ever steeper ones (7.5° at a time, to −85°) that
 * does. `groundAt` gives the terrain height for each candidate's sight-line points (null where
 * unknown, which counts as clear). A camera parked inside a valley wall drew nothing at all.
 */
export function clearOrbitPitch(
  pitchDeg: number,
  candidates: ReadonlyArray<{ pitchDeg: number; line: ReadonlyArray<{ heightM: number }> }>,
  groundAt: (candidate: number, point: number) => number | null,
  clearanceM = 40,
): number {
  for (const [ci, c] of candidates.entries()) {
    const clear = c.line.every((pt, pi) => {
      const g = groundAt(ci, pi);
      return g === null || pt.heightM >= g + clearanceM;
    });
    if (clear) return c.pitchDeg;
  }
  return candidates.at(-1)?.pitchDeg ?? pitchDeg;
}

/** Candidate pitches for `clearOrbitPitch`: the requested one, then steeper by 7.5° to −85°. */
export function steeperPitches(pitchDeg: number): number[] {
  const out = [Math.max(-85, Math.min(-1, pitchDeg))];
  while (out.at(-1)! > -85) out.push(Math.max(-85, out.at(-1)! - 7.5));
  return out;
}

/** Where a viewpoint's eye stands: degrees and metres above the ellipsoid. */
export interface EyePosition {
  longitude: number;
  latitude: number;
  heightM: number;
}

/** A move this far or farther (metres) is a jump to a new place, not a step: no glide. */
export const EYE_EASE_MAX_M = 250;
/** A glide lasts the time since the step before (so a held key walks at a steady speed), within these bounds. */
export const EYE_GLIDE_MIN_MS = 40;
export const EYE_GLIDE_MAX_MS = 250;

/** Metres between two eye positions (flat-earth, ample under EYE_EASE_MAX_M). */
export function eyeDistanceM(a: EyePosition, b: EyePosition): number {
  const kx = 111_320 * Math.cos(((a.latitude + b.latitude) / 2) * DEG);
  return Math.hypot(
    (b.longitude - a.longitude) * kx,
    (b.latitude - a.latitude) * 110_540,
    b.heightM - a.heightM,
  );
}

/** How long a glide to a new step takes: the interval since the last step, clamped. */
export function eyeGlideDurationMs(sinceLastStepMs: number): number {
  return Math.max(EYE_GLIDE_MIN_MS, Math.min(EYE_GLIDE_MAX_MS, sinceLastStepMs));
}

/**
 * Where the eye is `elapsedMs` into a glide of `durationMs` from `from` to `to`: at a constant
 * speed, so steps that arrive one glide apart (a held W key) join into one steady walk, and the
 * eye is where the step put it when the next one comes. `done` at the end.
 */
export function glideEyeAt(
  from: EyePosition,
  to: EyePosition,
  elapsedMs: number,
  durationMs: number,
): { eye: EyePosition; done: boolean } {
  const t = durationMs > 0 ? Math.max(0, elapsedMs) / durationMs : 1;
  if (t >= 1) return { eye: { ...to }, done: true };
  return {
    eye: {
      longitude: from.longitude + (to.longitude - from.longitude) * t,
      latitude: from.latitude + (to.latitude - from.latitude) * t,
      heightM: from.heightM + (to.heightM - from.heightM) * t,
    },
    done: false,
  };
}

/** The eye settles down onto lower ground with this time constant (ms). */
export const EYE_SETTLE_TAU_MS = 120;

/**
 * The lift the drawn ground gives a viewpoint eye over the height it should stand at: up at once
 * (the eye must never sink into the drawn ground), down gently as finer terrain lowers the
 * surface (snapping down jolted the view while walking), and a rise of the wanted height (a
 * terrain look-up catching up) taken off the lift at once so the eye never overshoots.
 * `surfaceM` is the drawn ground under the eye (null if unknown); `settling` while it eases.
 */
export function eyeLift(
  prev: { liftM: number; wantedM: number | null },
  wantedM: number,
  surfaceM: number | null,
  dtMs: number,
  tauMs = EYE_SETTLE_TAU_MS,
): { liftM: number; settling: boolean } {
  const needed =
    surfaceM !== null && Number.isFinite(surfaceM) && wantedM < surfaceM + 0.5
      ? surfaceM + 1.7 - wantedM
      : 0;
  let held = prev.liftM;
  if (prev.wantedM !== null && wantedM > prev.wantedM)
    held = Math.max(needed, held - (wantedM - prev.wantedM));
  if (needed >= held) return { liftM: needed, settling: false };
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  const lift = held + (needed - held) * k;
  return lift - needed > 0.05
    ? { liftM: lift, settling: true }
    : { liftM: needed, settling: false };
}

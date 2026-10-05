/**
 * Physically based clear-sky colour (roadmap Phase 4 "atmospheric scattering"): single-scattering
 * Rayleigh + Mie radiance along a view ray through a spherical atmosphere, after Nishita et al.
 * (1993) as commonly implemented (Bruneton & Neyret's sea-level coefficients, Cornette–Shanks
 * Mie phase). Three RGB bands at 680/550/440 nm — enough for the colour of the sky; it is not a
 * spectral renderer.
 *
 * What it gives: the blue of a clear zenith, the whitening toward the horizon, the reddening of
 * the sun's side of the sky at low Sun and the way haze pales all of it, all from the Sun's
 * geometric elevation and the scenario's haze. What it does not give: twilight and night (single
 * scattering goes dark once the Sun sets — the callers blend to their twilight terms there),
 * clouds, ozone, ground albedo. Pure maths, so it is unit tested and runs on the server too.
 */

export interface SkyRadianceInput {
  /** Geometric Sun elevation, degrees. */
  sunElevationDeg: number;
  /** Elevation of the view direction, degrees (90 = zenith; a little below 0 looks at the ground). */
  viewElevationDeg: number;
  /** Azimuth of the view direction relative to the Sun's, degrees (0 = toward the Sun). */
  relativeAzimuthDeg: number;
  /** Scenario haze 0–1; scales the aerosol (Mie) density. 0.1 is a clear day. */
  haze?: number;
}

/** Linear RGB radiance (arbitrary units: the Sun's irradiance is 20 per band). */
export type LinearRgb = [number, number, number];

const EARTH_RADIUS_M = 6_371_000;
const ATMOSPHERE_TOP_M = EARTH_RADIUS_M + 80_000;
/** Sea-level Rayleigh scattering coefficients, m⁻¹, at 680 / 550 / 440 nm (∝ λ⁻⁴). */
const BETA_RAYLEIGH: LinearRgb = [5.8e-6, 13.5e-6, 33.1e-6];
/** Sea-level Mie scattering coefficient, m⁻¹ (wavelength-independent); extinction is 10 % more. */
const BETA_MIE = 21e-6;
const MIE_EXTINCTION_RATIO = 1.1;
const RAYLEIGH_SCALE_HEIGHT_M = 8_000;
const MIE_SCALE_HEIGHT_M = 1_200;
/** Cornette–Shanks asymmetry: strong forward scattering, the halo around a low Sun. */
const MIE_G = 0.76;
const SUN_IRRADIANCE = 20;
const OBSERVER_HEIGHT_M = 2;
const VIEW_SAMPLES = 32;
const SUN_SAMPLES = 8;

const DEG = Math.PI / 180;

type Vec3 = [number, number, number];

function direction(elevationDeg: number, azimuthDeg: number): Vec3 {
  const e = elevationDeg * DEG;
  const a = azimuthDeg * DEG;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Distance along `dir` from `origin` to the sphere of radius `radius` (centre at the origin of
 * coordinates). `near` picks the nearer forward root (a ground hit), otherwise the farther one
 * (leaving the atmosphere). `null` when the ray misses or the hit lies behind the origin.
 */
function hitSphere(origin: Vec3, dir: Vec3, radius: number, near: boolean): number | null {
  const b = dot(origin, dir);
  const c = dot(origin, origin) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t = near ? -b - root : -b + root;
  return t > 0 ? t : null;
}

/**
 * Mie density multiplier for a scenario's haze, in units of the sea-level coefficient above
 * (which describes a moderately hazy "standard" atmosphere): a clear day (haze 0.1) is about half
 * of it, the stormiest scenario about three times.
 */
export function mieScaleForHaze(haze: number): number {
  const h = Math.max(0, Math.min(1, haze));
  return 0.15 + 3 * h;
}

/** Optical depths (Rayleigh, Mie-in-units-of-sea-level) from `p` toward the Sun, or null in the Earth's shadow. */
function sunOpticalDepth(p: Vec3, sun: Vec3, mieScale: number): [number, number] | null {
  // Inside the ground (a last sample rounding under the surface) or a Sun ray that enters it.
  if (dot(p, p) < EARTH_RADIUS_M * EARTH_RADIUS_M) return null;
  if (hitSphere(p, sun, EARTH_RADIUS_M, true) !== null) return null;
  const tMax = hitSphere(p, sun, ATMOSPHERE_TOP_M, false);
  if (tMax === null) return null;
  const ds = tMax / SUN_SAMPLES;
  let tr = 0;
  let tm = 0;
  for (let i = 0; i < SUN_SAMPLES; i++) {
    const t = (i + 0.5) * ds;
    const q: Vec3 = [p[0] + sun[0] * t, p[1] + sun[1] * t, p[2] + sun[2] * t];
    const h = Math.max(0, Math.hypot(q[0], q[1], q[2]) - EARTH_RADIUS_M);
    tr += Math.exp(-h / RAYLEIGH_SCALE_HEIGHT_M) * ds;
    tm += Math.exp(-h / MIE_SCALE_HEIGHT_M) * mieScale * ds;
  }
  return [tr, tm];
}

/** Sky radiance along one view direction, linear RGB (only the air before the ground when looking down). */
export function skyRadiance(input: SkyRadianceInput): LinearRgb {
  const mieScale = mieScaleForHaze(input.haze ?? 0.1);
  const origin: Vec3 = [0, 0, EARTH_RADIUS_M + OBSERVER_HEIGHT_M];
  const view = direction(input.viewElevationDeg, input.relativeAzimuthDeg);
  const sun = direction(input.sunElevationDeg, 0);
  const ground = hitSphere(origin, view, EARTH_RADIUS_M, true);
  const top = hitSphere(origin, view, ATMOSPHERE_TOP_M, false);
  const tMax = ground ?? top;
  if (tMax === null || tMax <= 0) return [0, 0, 0];

  const mu = dot(view, sun);
  const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g2 = MIE_G * MIE_G;
  const phaseM =
    ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) /
    ((2 + g2) * Math.pow(1 + g2 - 2 * MIE_G * mu, 1.5));

  const ds = tMax / VIEW_SAMPLES;
  let viewR = 0; // optical depth so far, Rayleigh
  let viewM = 0;
  const out: LinearRgb = [0, 0, 0];
  for (let i = 0; i < VIEW_SAMPLES; i++) {
    const t = (i + 0.5) * ds;
    const p: Vec3 = [origin[0] + view[0] * t, origin[1] + view[1] * t, origin[2] + view[2] * t];
    const h = Math.max(0, Math.hypot(p[0], p[1], p[2]) - EARTH_RADIUS_M);
    const densR = Math.exp(-h / RAYLEIGH_SCALE_HEIGHT_M);
    const densM = Math.exp(-h / MIE_SCALE_HEIGHT_M) * mieScale;
    // Optical depth from the observer to the sample point itself (half of this segment), then
    // the whole segment goes on the running total for the next one.
    const midR = viewR + densR * ds * 0.5;
    const midM = viewM + densM * ds * 0.5;
    viewR += densR * ds;
    viewM += densM * ds;
    const toSun = sunOpticalDepth(p, sun, mieScale);
    if (!toSun) continue; // the Earth shades this point
    const tauM = (midM + toSun[1]) * BETA_MIE * MIE_EXTINCTION_RATIO;
    const tauR = midR + toSun[0];
    for (let c = 0; c < 3; c++) {
      const beta = BETA_RAYLEIGH[c] ?? 0;
      const tau = tauR * beta + tauM;
      const scatter = beta * phaseR * densR + BETA_MIE * phaseM * densM;
      out[c] = (out[c] ?? 0) + SUN_IRRADIANCE * scatter * Math.exp(-tau) * ds;
    }
  }
  return out;
}

/**
 * Exposure 1 − e^(−k·Y) on the luminance only, the chromaticity kept (so a blue sky stays as
 * blue as the physics says and a sunset stays orange until it clips), then sRGB gamma.
 */
export function toneMap(l: LinearRgb, exposure: number): [number, number, number] {
  const r = Math.max(0, l[0]);
  const g = Math.max(0, l[1]);
  const b = Math.max(0, l[2]);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (!(y > 0) || !Number.isFinite(y)) return [0, 0, 0];
  const scale = (1 - Math.exp(-exposure * y)) / y;
  const map = (v: number) => Math.round(Math.pow(Math.min(1, v * scale), 1 / 2.2) * 255);
  return [map(r), map(g), map(b)];
}

/**
 * Exposure that puts the zenith of a clear mid-afternoon sky (Sun at 45°) at the luminance of a
 * mid-blue (linear Y ≈ 0.26; the hue is the model's own): one constant for every sky the planner
 * shows, so brightness differences between skies are the model's, not a per-frame auto-exposure.
 * Computed once.
 */
let referenceExposure: number | null = null;
export function skyExposure(): number {
  if (referenceExposure === null) {
    const z = skyRadiance({
      sunElevationDeg: 45,
      viewElevationDeg: 90,
      relativeAzimuthDeg: 0,
      haze: 0.1,
    });
    const y = 0.2126 * z[0] + 0.7152 * z[1] + 0.0722 * z[2];
    referenceExposure = -Math.log(1 - 0.26) / Math.max(1e-12, y);
  }
  return referenceExposure;
}

export interface SkyStops {
  /** Overhead, away from the Sun's aureole. */
  zenith: [number, number, number];
  /** 30° up, 90° around from the Sun — the broad mid-sky. */
  mid: [number, number, number];
  /** Just above the horizon, 90° around from the Sun: the pale daytime horizon. */
  horizon: [number, number, number];
  /**
   * Just above the horizon, 25° around from the Sun: the colour of the sunrise/sunset glow
   * without the Sun's own aureole (by day, the Sun's side of the horizon).
   */
  glow: [number, number, number];
}

/**
 * The three colours a vertical sky gradient needs, sRGB 0–255, for a clear sky. The samples
 * keep clear of the Sun itself: near the Sun the forward-scattering aureole is white, and a
 * gradient stop is the sky, not the Sun. Four samples: overhead, mid-sky, the horizon away
 * from the Sun and the horizon toward it (the glow).
 */
export function clearSkyStops(sunElevationDeg: number, haze = 0.1): SkyStops {
  const k = skyExposure();
  const at = (viewElevationDeg: number, relativeAzimuthDeg: number) =>
    toneMap(skyRadiance({ sunElevationDeg, viewElevationDeg, relativeAzimuthDeg, haze }), k);
  // Overhead: straight up unless the Sun is within 40° of the zenith, then 40° away from it.
  const zenithEl = sunElevationDeg > 50 ? 140 - sunElevationDeg : 90;
  return {
    zenith: at(zenithEl, 180),
    mid: at(30, 90),
    horizon: at(2, 90),
    glow: at(2, 25),
  };
}

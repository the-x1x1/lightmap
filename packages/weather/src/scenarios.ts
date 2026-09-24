/**
 * Lighting scenarios (plan §9, §10). Deterministic: the same scenario always yields the same
 * atmosphere parameters, and a forecast frame maps to a scenario (and to parameters directly)
 * through pure functions. Unit tested; no randomness.
 *
 * The parameters are what the renderer and the Quality-0 overlay consume. They are physically
 * motivated but deliberately simple:
 *   sunTransmittance   — fraction of direct sunlight reaching the ground (drives shadow contrast)
 *   diffuseFraction    — how much of the light is sky light (soft, directionless)
 *   skyLuminance       — relative brightness of the sky dome
 *   cloudOpacity/Density — how much cloud is drawn, and how thick each cloud reads
 *   haze               — aerial perspective / visibility loss
 *   saturation/contrast — grading multipliers around 1.0
 */

export type WeatherScenarioId = 'clear' | 'mostly-clear' | 'partly-cloudy' | 'overcast' | 'storm';

export interface AtmosphereParameters {
  /** 0–1 */
  cloudOpacity: number;
  /** 0–1 */
  cloudDensity: number;
  /** 0–1: fraction of direct sunlight reaching the ground. */
  sunTransmittance: number;
  /** 0–1: share of illumination that is diffuse. */
  diffuseFraction: number;
  /** 0–1.5: relative sky brightness. */
  skyLuminance: number;
  /** 0–1 */
  haze: number;
  /** multiplier, 1 = neutral */
  saturation: number;
  /** multiplier, 1 = neutral */
  contrast: number;
  /** 0–1 */
  precipitation: number;
  /** Cloud cover fraction 0–1 that the parameters were derived from. */
  cloudCover: number;
}

export interface WeatherScenario {
  id: WeatherScenarioId;
  label: string;
  /** Short line under the label in the picker. */
  hint: string;
  /** Representative total cloud cover, percent. */
  cloudCoverPercent: number;
  parameters: AtmosphereParameters;
}

const P = (
  cloudCover: number,
  cloudOpacity: number,
  cloudDensity: number,
  sunTransmittance: number,
  diffuseFraction: number,
  skyLuminance: number,
  haze: number,
  saturation: number,
  contrast: number,
  precipitation: number,
): AtmosphereParameters => ({
  cloudCover,
  cloudOpacity,
  cloudDensity,
  sunTransmittance,
  diffuseFraction,
  skyLuminance,
  haze,
  saturation,
  contrast,
  precipitation,
});

export const SCENARIOS: readonly WeatherScenario[] = Object.freeze([
  {
    id: 'clear',
    label: 'Clear',
    hint: 'Hard light, deep shadows, saturated sky',
    cloudCoverPercent: 5,
    parameters: P(0.05, 0.05, 0.2, 1.0, 0.15, 1.0, 0.1, 1.0, 1.0, 0),
  },
  {
    id: 'mostly-clear',
    label: 'Mostly Clear',
    hint: 'Scattered cloud, occasional softening',
    cloudCoverPercent: 25,
    parameters: P(0.25, 0.3, 0.35, 0.92, 0.25, 1.0, 0.15, 0.98, 0.97, 0),
  },
  {
    id: 'partly-cloudy',
    label: 'Partly Cloudy',
    hint: 'Broken cloud, light comes and goes',
    cloudCoverPercent: 55,
    parameters: P(0.55, 0.6, 0.5, 0.7, 0.45, 1.05, 0.25, 0.95, 0.9, 0),
  },
  {
    id: 'overcast',
    label: 'Overcast',
    hint: 'Soft, even light, no visible sun or shadows',
    cloudCoverPercent: 95,
    parameters: P(0.95, 0.95, 0.85, 0.2, 0.9, 0.85, 0.45, 0.85, 0.75, 0),
  },
  {
    id: 'storm',
    label: 'Rain / Storm',
    hint: 'Dark sky, flat light, wet surfaces',
    cloudCoverPercent: 100,
    parameters: P(1.0, 1.0, 1.0, 0.08, 0.97, 0.55, 0.7, 0.7, 0.65, 1),
  },
]);

export function scenarioById(id: WeatherScenarioId): WeatherScenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scenario ${id}`);
  return s;
}

export function isScenarioId(v: unknown): v is WeatherScenarioId {
  return typeof v === 'string' && SCENARIOS.some((s) => s.id === v);
}

/** Nearest named scenario for a cloud-cover percentage and precipitation, used to label forecasts. */
export function scenarioForConditions(
  cloudCoverPercent: number,
  opts: {
    precipitationAmount?: number | null;
    precipitationProbability?: number | null;
    weatherCode?: number | null;
  } = {},
): WeatherScenarioId {
  const rain =
    (opts.precipitationAmount ?? 0) >= 0.5 ||
    (opts.precipitationProbability ?? 0) >= 60 ||
    (opts.weatherCode !== null && opts.weatherCode !== undefined && opts.weatherCode >= 61);
  if (rain) return 'storm';
  if (cloudCoverPercent < 12) return 'clear';
  if (cloudCoverPercent < 40) return 'mostly-clear';
  if (cloudCoverPercent < 80) return 'partly-cloudy';
  return 'overcast';
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Continuous parameters from a forecast frame, so a forecast renders with its actual cloud amount
 * rather than snapping to the nearest scenario. Piecewise-linear interpolation through the
 * scenario anchor points on cloud cover, then adjustments for visibility and precipitation.
 */
export function parametersForForecast(frame: {
  cloudCoverTotal: number;
  cloudCoverLow?: number | null;
  visibility?: number | null;
  precipitationAmount?: number | null;
  precipitationProbability?: number | null;
  weatherCode?: number | null;
}): AtmosphereParameters {
  const cover = clamp01(frame.cloudCoverTotal / 100);
  const anchors = SCENARIOS.filter((s) => s.id !== 'storm')
    .map((s) => ({ x: s.parameters.cloudCover, p: s.parameters }))
    .sort((a, b) => a.x - b.x);
  let lo = anchors[0]!;
  let hi = anchors[anchors.length - 1]!;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (cover >= anchors[i]!.x && cover <= anchors[i + 1]!.x) {
      lo = anchors[i]!;
      hi = anchors[i + 1]!;
      break;
    }
  }
  const f = hi.x === lo.x ? 0 : clamp01((cover - lo.x) / (hi.x - lo.x));
  const mix = (k: keyof AtmosphereParameters) => lo.p[k] + (hi.p[k] - lo.p[k]) * f;
  const out: AtmosphereParameters = {
    cloudCover: cover,
    cloudOpacity: mix('cloudOpacity'),
    cloudDensity: mix('cloudDensity'),
    sunTransmittance: mix('sunTransmittance'),
    diffuseFraction: mix('diffuseFraction'),
    skyLuminance: mix('skyLuminance'),
    haze: mix('haze'),
    saturation: mix('saturation'),
    contrast: mix('contrast'),
    precipitation: 0,
  };
  // Low cloud blocks the sun more than the same amount of high cloud.
  if (frame.cloudCoverLow !== null && frame.cloudCoverLow !== undefined) {
    const low = clamp01(frame.cloudCoverLow / 100);
    out.sunTransmittance = clamp01(out.sunTransmittance * (1 - 0.5 * low));
    out.cloudDensity = clamp01(out.cloudDensity + 0.3 * low);
  }
  // Visibility → haze. 40 km+ is crisp; 5 km is noticeably hazy; < 1 km is fog.
  if (
    frame.visibility !== null &&
    frame.visibility !== undefined &&
    Number.isFinite(frame.visibility)
  ) {
    const km = frame.visibility / 1000;
    const hazeFromVis =
      km >= 40 ? 0.05 : km >= 20 ? 0.15 : km >= 10 ? 0.3 : km >= 5 ? 0.5 : km >= 1 ? 0.75 : 0.95;
    out.haze = Math.max(out.haze, hazeFromVis);
    if (km < 1) {
      out.sunTransmittance = Math.min(out.sunTransmittance, 0.15);
      out.diffuseFraction = Math.max(out.diffuseFraction, 0.9);
      out.contrast = Math.min(out.contrast, 0.7);
    }
  }
  const rainy = scenarioForConditions(frame.cloudCoverTotal, frame) === 'storm';
  if (rainy) {
    const storm = scenarioById('storm').parameters;
    const w = clamp01(
      ((frame.precipitationAmount ?? 0) / 2 + (frame.precipitationProbability ?? 50) / 100) / 2 +
        0.3,
    );
    for (const k of [
      'cloudOpacity',
      'cloudDensity',
      'sunTransmittance',
      'diffuseFraction',
      'skyLuminance',
      'haze',
      'saturation',
      'contrast',
    ] as const) {
      out[k] = out[k] + (storm[k] - out[k]) * w;
    }
    out.precipitation = w;
  }
  return out;
}

/**
 * Colour temperature of direct sunlight as a function of solar elevation (plan §10). The curve is
 * configurable; these anchors are the defaults. Returned as Kelvin plus a normalised warmth 0–1
 * that the grade shader uses directly.
 */
export interface ColorTemperatureCurvePoint {
  elevationDeg: number;
  kelvin: number;
}

export const DEFAULT_COLOR_TEMPERATURE_CURVE: readonly ColorTemperatureCurvePoint[] = Object.freeze(
  [
    { elevationDeg: -18, kelvin: 11000 }, // astronomical twilight: only the darkest blue sky light
    { elevationDeg: -12, kelvin: 10000 },
    { elevationDeg: -6, kelvin: 9000 }, // end of civil twilight
    { elevationDeg: -4, kelvin: 8000 }, // blue hour proper
    { elevationDeg: -2, kelvin: 6500 }, // afterglow: sky light takes over from the last direct light
    { elevationDeg: -0.833, kelvin: 3200 }, // last direct light at sunset
    { elevationDeg: 0, kelvin: 2900 }, // sun on the horizon
    { elevationDeg: 5, kelvin: 3800 }, // golden light
    { elevationDeg: 10, kelvin: 4800 },
    { elevationDeg: 20, kelvin: 5400 }, // neutral daylight from here up
    { elevationDeg: 90, kelvin: 5600 },
  ],
);

export function colorTemperatureKelvin(
  elevationDeg: number,
  curve: readonly ColorTemperatureCurvePoint[] = DEFAULT_COLOR_TEMPERATURE_CURVE,
): number {
  if (curve.length === 0) return 5600;
  if (elevationDeg <= curve[0]!.elevationDeg) return curve[0]!.kelvin;
  const last = curve[curve.length - 1]!;
  if (elevationDeg >= last.elevationDeg) return last.kelvin;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    if (elevationDeg >= a.elevationDeg && elevationDeg <= b.elevationDeg) {
      const f = (elevationDeg - a.elevationDeg) / (b.elevationDeg - a.elevationDeg);
      return a.kelvin + (b.kelvin - a.kelvin) * f;
    }
  }
  return last.kelvin;
}

/** Warmth 0 (cool/blue) … 0.5 (neutral) … 1 (very warm), for shaders and the sky gradient. */
export function warmthFromKelvin(kelvin: number): number {
  // 2900 K → 1, 5600 K → 0.5, 9000 K → 0
  if (kelvin <= 5600) return 0.5 + (0.5 * (5600 - kelvin)) / 2700;
  return Math.max(0, 0.5 - (0.5 * (kelvin - 5600)) / 3400);
}

/**
 * Approximate sRGB tint of a blackbody at `kelvin`, normalised so that `whiteKelvin` (default
 * 5600 K, neutral daylight) is exactly white. Uses a standard planckian-locus approximation
 * (Tanner Helland's fit, widely published), which is adequate for a grading tint.
 */
export function kelvinToRgb(kelvin: number, whiteKelvin = 5600): [number, number, number] {
  const raw = blackbodyRgb(kelvin);
  const white = blackbodyRgb(whiteKelvin);
  const norm = (i: 0 | 1 | 2) => Math.max(0, Math.min(1, raw[i] / Math.max(1e-3, white[i])));
  return [norm(0), norm(1), norm(2)];
}

function blackbodyRgb(kelvin: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

/**
 * Exposure estimate (plan §1 "what should the light actually look like from here"): the
 * incident illuminance the sky and the scenario put on the ground at the planned instant, as an
 * exposure value at ISO 100 and one honest starting setting — "EV 14.8 · 1/500 s f/8 ISO 100".
 *
 * A model, not a meter. Clear-sky daylight follows the usual engineering curve: direct normal
 * illuminance ≈ 118 klx · e^(−0.19·(m−1)) over Kasten–Young air mass m, times sin(elevation)
 * onto the horizontal, plus a diffuse sky term ≈ 12 klx · sin(h)^0.7; twilight falls by a
 * factor of ten every 2.7° of Sun depression from ≈ 600 lx at sunset. Cloud scales the day by
 * the scenario's own direct-light share (overcast noon ≈ 18 klx, storm ≈ 9 klx), twilight by
 * its square root, blended over the Sun's first five degrees. At night the
 * Moon adds ≈ 0.26 lx · sin(h) at full, falling steeply with phase, over a 0.002 lx
 * starlight-and-airglow floor. Where towns light the sky (`skyGlowRatio`, the sky's brightness
 * over a natural one: ~1 in the desert, ~7 in a suburb, up to 60 in a city) the floor is raised
 * by that much, and cloud, which dims the stars, reflects the towns' light back down (up to
 * three times as bright under overcast, as a city's orange cloud base shows).
 * EV100 = log2(E / 2.5) (an incident meter's constant C = 250). Pure, unit-tested.
 */

/** Direct normal illuminance outside the atmosphere's attenuation, lux (≈ 118 klx at air mass 1). */
const DIRECT_NORMAL_KLX = 118_000;
/** Clear-sky diffuse term at the zenith, lux. */
const DIFFUSE_ZENITH_LX = 12_000;
/** Horizontal illuminance with the Sun on the horizon, lux. */
const SUNSET_LX = 600;
/** Twilight: one decade of illuminance per this many degrees of Sun depression. */
const TWILIGHT_DECADE_DEG = 2.7;
/** Full Moon at the zenith, lux. */
const FULL_MOON_ZENITH_LX = 0.26;
/** Starlight, airglow and zodiacal light together on a clear moonless night, lux. */
const STARLIGHT_LX = 0.002;
/** Incident-meter calibration constant: EV = log2(E · ISO / C). */
const METER_C = 250;

/** Kasten–Young relative air mass for a geometric Sun elevation in degrees (≥ −1°). */
export function airMass(elevationDeg: number): number {
  const h = Math.max(-1, elevationDeg);
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/** Clear-sky horizontal illuminance, lux, for a Sun elevation in degrees (day and twilight). */
export function clearSkyIlluminanceLux(sunElevationDeg: number): number {
  const h = sunElevationDeg;
  if (h <= 0) return SUNSET_LX * Math.pow(10, h / TWILIGHT_DECADE_DEG);
  const s = Math.sin((h * Math.PI) / 180);
  const direct = DIRECT_NORMAL_KLX * Math.exp(-0.19 * (airMass(h) - 1)) * s;
  const diffuse = DIFFUSE_ZENITH_LX * Math.pow(s, 0.7);
  return SUNSET_LX + direct + diffuse;
}

/** How much of the clear-sky illuminance a scenario leaves, from its direct-light share 0–1. */
export function cloudIlluminanceFactor(sunTransmittance: number): number {
  const t = Math.max(0, Math.min(1, sunTransmittance));
  return 0.05 + 0.95 * Math.pow(t, 1.5);
}

/** Moonlight on the ground, lux, from the Moon's elevation and illuminated fraction. */
export function moonlightLux(moonElevationDeg: number, illuminatedFraction: number): number {
  if (moonElevationDeg <= 0) return 0;
  const f = Math.max(0, Math.min(1, illuminatedFraction));
  // The phase curve is steep: a half Moon gives about a tenth of a full one.
  return FULL_MOON_ZENITH_LX * Math.sin((moonElevationDeg * Math.PI) / 180) * Math.pow(f, 3.3);
}

export interface ExposureEstimate {
  /** Incident illuminance on the ground, lux. */
  illuminanceLux: number;
  /** Exposure value at ISO 100. */
  ev100: number;
  /** One starting setting at a sensible aperture and ISO for the light. */
  setting: { aperture: number; shutter: string; iso: number };
  /** What the number rests on. */
  basis: 'sun' | 'twilight' | 'moon' | 'stars' | 'city glow';
}

export interface ExposureInput {
  sunElevationDeg: number;
  /** The scenario's direct-light share, 0–1 (`AtmosphereParameters.sunTransmittance`). */
  sunTransmittance: number;
  moon?: { elevationDeg: number; illuminatedFraction: number } | null;
  /** The night sky's brightness over a natural one from town light (1 or absent: none). */
  skyGlowRatio?: number;
}

/** Standard shutter steps, seconds, from 1/8000 s to 4 min. */
const SHUTTERS = [
  1 / 8000,
  1 / 4000,
  1 / 2000,
  1 / 1000,
  1 / 500,
  1 / 250,
  1 / 125,
  1 / 60,
  1 / 30,
  1 / 15,
  1 / 8,
  1 / 4,
  1 / 2,
  1,
  2,
  4,
  8,
  15,
  30,
  60,
  120,
  240,
];

/** "1/500 s", "2 s", "30 s", "4 min". */
export function formatShutter(seconds: number): string {
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  if (seconds >= 1) return `${Math.round(seconds)} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

/** The nearest standard shutter to a required time; the longest step when even that is short. */
export function nearestShutter(seconds: number): number {
  let best = SHUTTERS[0]!;
  for (const s of SHUTTERS)
    if (Math.abs(Math.log2(s / seconds)) < Math.abs(Math.log2(best / seconds))) best = s;
  return best;
}

export function estimateExposure(input: ExposureInput): ExposureEstimate {
  const h = input.sunElevationDeg;
  // Cloud dims the day by the scenario's direct share; twilight by the square root of it (the
  // sky, not the Sun, is the source then — an overcast dusk is a stop or two darker than a clear
  // one, not three), blended over the Sun's first five degrees so the figure never steps at the
  // horizon; the Moon and the stars by a gentler factor still.
  const cloud = cloudIlluminanceFactor(input.sunTransmittance);
  const twilightCloud = Math.sqrt(cloud);
  const blend = Math.max(0, Math.min(1, h / 5));
  const sky = clearSkyIlluminanceLux(h) * (twilightCloud + (cloud - twilightCloud) * blend);
  const night = input.moon
    ? moonlightLux(input.moon.elevationDeg, input.moon.illuminatedFraction)
    : 0;
  const nightFactor = 0.4 + 0.6 * Math.max(0, Math.min(1, input.sunTransmittance));
  const glowRatio = Math.max(1, Math.min(60, input.skyGlowRatio ?? 1));
  const cloudCover = 1 - Math.max(0, Math.min(1, input.sunTransmittance));
  const glow = STARLIGHT_LX * (glowRatio - 1) * (1 + 2 * cloudCover);
  const lux = sky + (night + STARLIGHT_LX) * nightFactor + glow;
  const ev100 = Math.log2((lux * 100) / METER_C);
  const basis: ExposureEstimate['basis'] =
    h > -0.833
      ? 'sun'
      : h > -12 && sky > night + STARLIGHT_LX + glow
        ? 'twilight'
        : glow > night && glow > STARLIGHT_LX
          ? 'city glow'
          : night > STARLIGHT_LX
            ? 'moon'
            : 'stars';
  // Daylight at f/8 ISO 100; low light opens up and raises ISO so the shutter stays usable.
  const [aperture, iso] = ev100 >= 9 ? [8, 100] : ev100 >= 3 ? [4, 400] : [2.8, 3200];
  const evAtIso = ev100 + Math.log2(iso / 100);
  const shutter = nearestShutter((aperture * aperture) / Math.pow(2, evAtIso));
  return {
    illuminanceLux: lux,
    ev100,
    setting: { aperture, shutter: formatShutter(shutter), iso },
    basis,
  };
}

/** "EV 14.8 · 1/500 s f/8 ISO 100". */
export function describeExposure(e: ExposureEstimate): string {
  const ev = e.ev100 < 0 ? `−${Math.abs(e.ev100).toFixed(1)}` : e.ev100.toFixed(1);
  return `EV ${ev} · ${e.setting.shutter} f/${e.setting.aperture} ISO ${e.setting.iso}`;
}

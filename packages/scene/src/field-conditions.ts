/**
 * Field conditions (plan §1 B lists humidity, fog and wind beside cloud): what the forecast
 * frame says about the shoot rather than the light — the wind on the tripod and in the clouds,
 * and whether the glass will fog or dew. From the frame's own fields: Beaufort's bands for the
 * wind (speed at 10 m), the WMO threshold for fog (visibility under 1 km, or the fog weather
 * codes), dew called likely at ≥ 95 % relative humidity (the air within about a degree of its
 * dew point) and possible on a calm, mostly clear night above 85 %, when radiative cooling takes
 * a surface below the dew point first. Pure; a scenario has no frame and gives no lines.
 */
import { compassLabel } from '@lightmap/geospatial';
import type { WeatherFrame } from '@lightmap/weather';
import { M_PER_MI, feetFromMetres, type DistanceUnits } from './optics.ts';

export type WindStrength = 'calm' | 'light' | 'moderate' | 'fresh' | 'strong' | 'gale';

/** Beaufort 0 / 1–2 / 3–4 / 5–6 / 7 / 8 and above, from the speed in m/s. */
export function windStrength(mps: number): WindStrength {
  if (mps < 0.5) return 'calm';
  if (mps < 3.4) return 'light';
  if (mps < 8) return 'moderate';
  if (mps < 13.9) return 'fresh';
  if (mps < 17.2) return 'strong';
  return 'gale';
}

export type MoistureRisk = 'fog' | 'dew-likely' | 'dew-possible' | null;

export interface FieldLine {
  label: 'Wind' | 'Humidity';
  /** "9 mph from the ENE", "calm", "97 %". */
  value: string;
  /** What to do about it, or null when there is nothing to act on. */
  note: string | null;
}

const MPH_PER_MPS = 3600 / M_PER_MI;
/** Dew is likely once the air is this close to saturation, whatever the sky. */
export const DEW_LIKELY_HUMIDITY = 95;
/** On a calm, mostly clear night, surfaces cool below the dew point from here up. */
export const DEW_POSSIBLE_HUMIDITY = 85;
/** WMO: fog is visibility under one kilometre. */
export const FOG_VISIBILITY_M = 1000;

/** The wind in the chosen units, whole numbers: "4 m/s" / "9 mph". */
export function formatWindSpeed(mps: number, units: DistanceUnits = 'metric'): string {
  return units === 'metric' ? `${Math.round(mps)} m/s` : `${Math.round(mps * MPH_PER_MPS)} mph`;
}

/**
 * Visibility in the chosen units: metres below a kilometre, a tenth of a kilometre below ten,
 * whole kilometres above ("600 m", "4.5 km", "24 km"); imperial as feet below half a mile, then
 * miles to a tenth below ten and whole miles above.
 */
export function formatVisibility(m: number, units: DistanceUnits = 'metric'): string {
  if (units === 'metric') {
    if (m < 1000) return `${Math.round(m)} m`;
    if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
    return `${Math.round(m / 1000)} km`;
  }
  if (m < M_PER_MI / 2) return `${Math.round(feetFromMetres(m) / 100) * 100} ft`;
  if (m < 10 * M_PER_MI) return `${(m / M_PER_MI).toFixed(1)} mi`;
  return `${Math.round(m / M_PER_MI)} mi`;
}

const WIND_NOTE: Record<WindStrength, string | null> = {
  calm: null,
  light: null,
  moderate: null,
  fresh: 'fresh — weigh the tripod down; clouds streak in a long exposure',
  strong: 'strong — tripod shake likely; find a lee',
  gale: 'gale — hand-held only; spray and dust fly',
};

/** The wind line: speed and the quarter it blows from; calm air has no direction worth naming. */
export function describeWind(
  speedMps: number,
  fromDeg: number | null,
  units: DistanceUnits = 'metric',
): FieldLine {
  const strength = windStrength(speedMps);
  const value =
    strength === 'calm'
      ? 'calm'
      : `${formatWindSpeed(speedMps, units)}${fromDeg === null ? '' : ` from the ${compassLabel(fromDeg)}`}`;
  return { label: 'Wind', value, note: WIND_NOTE[strength] };
}

/** Fog by the frame's own evidence: the WMO visibility threshold or a fog weather code. */
export function isFog(frame: Pick<WeatherFrame, 'visibility' | 'weatherCode'>): boolean {
  return (
    (frame.visibility !== null && frame.visibility < FOG_VISIBILITY_M) ||
    frame.weatherCode === 45 ||
    frame.weatherCode === 48
  );
}

/**
 * The moisture risk for the glass. Fog outranks dew; dew is "possible" only when the night is
 * calm (Beaufort ≤ 2) and no more than half covered, since cloud and wind both keep a surface
 * from cooling below the dew point.
 */
export function moistureRisk(
  frame: Pick<
    WeatherFrame,
    'humidity' | 'visibility' | 'weatherCode' | 'windSpeed' | 'cloudCoverTotal'
  >,
  sunElevationDeg: number,
): MoistureRisk {
  if (isFog(frame)) return 'fog';
  if (frame.humidity === null) return null;
  if (frame.humidity >= DEW_LIKELY_HUMIDITY) return 'dew-likely';
  const calm = frame.windSpeed !== null && frame.windSpeed < 3.4; // Beaufort 0–2
  if (
    frame.humidity >= DEW_POSSIBLE_HUMIDITY &&
    sunElevationDeg < 0 &&
    calm &&
    frame.cloudCoverTotal <= 50
  )
    return 'dew-possible';
  return null;
}

const MOISTURE_NOTE: Record<Exclude<MoistureRisk, null>, string> = {
  fog: 'fog — lenses mist within minutes; keep a cloth and a lens warmer to hand',
  'dew-likely': 'near saturation — dew on the glass is likely; a lens warmer or a deep hood helps',
  'dew-possible': 'a calm, clear night this humid — dew on the glass is possible after dark',
};

/**
 * The lines for the weather details: the wind, then the humidity with its fog or dew note.
 * Lines whose field the frame lacks are left out; a null frame (a scenario) gives none.
 */
export function fieldConditions(
  frame: WeatherFrame | null,
  sunElevationDeg: number,
  units: DistanceUnits = 'metric',
): FieldLine[] {
  if (!frame) return [];
  const out: FieldLine[] = [];
  if (frame.windSpeed !== null) out.push(describeWind(frame.windSpeed, frame.windDirection, units));
  if (frame.humidity !== null) {
    const risk = moistureRisk(frame, sunElevationDeg);
    out.push({
      label: 'Humidity',
      value: `${Math.round(frame.humidity)} %`,
      note: risk ? MOISTURE_NOTE[risk] : null,
    });
  }
  return out;
}

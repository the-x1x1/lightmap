/**
 * AstronomyService — the interface the rest of LightMap depends on (plan §8). The default
 * implementation is LightMap's own Meeus/Almanac engine; the interface exists so a different
 * ephemeris can be substituted without touching SceneState or the UI (ADR-0006).
 *
 * Everything runs client-side in well under a millisecond, so the timeline can call
 * `getSolarState` on every scrub tick (plan §27: astronomical update < 16 ms).
 */
import {
  computeDayEvents,
  lightPhase,
  twilightBand,
  type DayEvents,
  type LightPhase,
} from './events.ts';
import { moonPosition, moonRiseSet, type MoonPhaseName } from './lunar.ts';
import { sunPosition } from './solar.ts';
import {
  localDayBounds,
  utcToWallClock,
  wallClockToUtc,
  type CivilTime,
  type WallClock,
} from './time.ts';

export interface SolarInput {
  latitude: number;
  longitude: number;
  /** UTC instant. */
  timestampUtc: Date;
  timeZone: string;
}

export interface SolarState {
  azimuthDegrees: number;
  elevationDegrees: number;
  /** Apparent (refracted) elevation, for horizon display. */
  apparentElevationDegrees: number;
  zenithDegrees: number;
  isAboveHorizon: boolean;
  /** Local apparent solar time as decimal hours (12.0 = solar noon). */
  solarTime: number;
  timestampUtc: Date;
  /** Wall clock at the location. */
  local: WallClock;
  declinationDegrees: number;
  equationOfTimeMinutes: number;
  /** Earth–Sun distance in AU (drives irradiance ±3.4 %). */
  distanceAu: number;
  phase: LightPhase;
  twilight: ReturnType<typeof twilightBand>;
  /** Compass label for the light direction ("SSE"). */
  compass: string;
  /** Normalised "how strong is the daylight" 0–1 from geometric elevation, for quick UI cues. */
  daylightFactor: number;
}

export type LunarInput = SolarInput;

export interface LunarState {
  azimuthDegrees: number;
  elevationDegrees: number;
  isAboveHorizon: boolean;
  illuminatedFraction: number;
  phaseName: MoonPhaseName;
  ageDays: number;
  waxing: boolean;
  distanceKm: number;
  timestampUtc: Date;
  /** Rise/set within the local civil day that contains the timestamp. */
  moonrise: Date | null;
  moonset: Date | null;
  alwaysUp: boolean;
  alwaysDown: boolean;
  accuracyNote: string;
}

export interface DayEventInput {
  latitude: number;
  longitude: number;
  date: Pick<CivilTime, 'year' | 'month' | 'day'>;
  timeZone: string;
}

export interface AstronomyService {
  getSolarState(input: SolarInput): SolarState;
  getLunarState(input: LunarInput): LunarState;
  getDayEvents(input: DayEventInput): DayEvents;
}

export const LUNAR_ACCURACY_NOTE =
  'Moon position ±0.3°, illumination ±2 %, rise/set ±3 min (Astronomical Almanac low-precision series).';

const COMPASS16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

export function compassFromAzimuth(az: number): string {
  const idx = Math.round((((az % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS16[idx] ?? 'N';
}

export class MeeusAstronomyService implements AstronomyService {
  getSolarState(input: SolarInput): SolarState {
    const p = sunPosition(input.timestampUtc, input.latitude, input.longitude);
    const local = utcToWallClock(input.timestampUtc, input.timeZone);
    // Local apparent solar time: hour angle 0 ⇒ 12 h.
    const solarTime = (((p.hourAngleDeg / 15 + 12) % 24) + 24) % 24;
    const daylightFactor = Math.max(0, Math.min(1, (p.elevationDeg + 6) / 30));
    return {
      azimuthDegrees: p.azimuthDeg,
      elevationDegrees: p.elevationDeg,
      apparentElevationDegrees: p.apparentElevationDeg,
      zenithDegrees: 90 - p.elevationDeg,
      isAboveHorizon: p.apparentElevationDeg > -0.2667, // upper limb above the horizon
      solarTime,
      timestampUtc: input.timestampUtc,
      local,
      declinationDegrees: p.declinationDeg,
      equationOfTimeMinutes: p.equationOfTimeMinutes,
      distanceAu: p.distanceAu,
      phase: lightPhase(p.elevationDeg),
      twilight: twilightBand(p.elevationDeg),
      compass: compassFromAzimuth(p.azimuthDeg),
      daylightFactor,
    };
  }

  getLunarState(input: LunarInput): LunarState {
    const m = moonPosition(input.timestampUtc, input.latitude, input.longitude);
    const local = utcToWallClock(input.timestampUtc, input.timeZone);
    const { start, end } = localDayBounds(local, input.timeZone);
    const rs = moonRiseSet(start, end, input.latitude, input.longitude);
    return {
      azimuthDegrees: m.azimuthDeg,
      elevationDegrees: m.topocentricElevationDeg,
      isAboveHorizon: m.topocentricElevationDeg > 0.125,
      illuminatedFraction: m.illuminatedFraction,
      phaseName: m.phaseName,
      ageDays: m.ageDays,
      waxing: m.waxing,
      distanceKm: m.distanceKm,
      timestampUtc: input.timestampUtc,
      moonrise: rs.moonrise,
      moonset: rs.moonset,
      alwaysUp: rs.alwaysUp,
      alwaysDown: rs.alwaysDown,
      accuracyNote: LUNAR_ACCURACY_NOTE,
    };
  }

  getDayEvents(input: DayEventInput): DayEvents {
    return computeDayEvents(input);
  }
}

/** Convenience: the UTC instant for a wall-clock selection at the location. */
export function localSelectionToUtc(
  date: Pick<CivilTime, 'year' | 'month' | 'day'>,
  minutesSinceMidnight: number,
  timeZone: string,
): Date {
  const start = wallClockToUtc({ ...date, hour: 0, minute: 0, second: 0 }, timeZone);
  return new Date(start.getTime() + minutesSinceMidnight * 60_000);
}

export const astronomy: AstronomyService = new MeeusAstronomyService();

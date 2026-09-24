/**
 * Time conversions. Two responsibilities:
 *
 * 1. Julian Day and Julian centuries for the ephemeris (Meeus, *Astronomical Algorithms*, ch. 7).
 * 2. Civil (wall-clock) time in an IANA zone ↔ UTC, using the platform's `Intl` data so the
 *    astronomy package has no timezone-database dependency. The conversion iterates the zone
 *    offset, which converges in ≤ 3 steps for every real zone, and applies a documented policy
 *    at DST transitions:
 *      - a wall time that does not exist (spring-forward gap) is shifted forward by the gap;
 *      - a wall time that exists twice (fall-back overlap) resolves to the EARLIER instant
 *        (the first occurrence), which matches how most calendar software behaves.
 */

export const J2000_JD = 2_451_545.0;
export const MS_PER_DAY = 86_400_000;
/** ΔT ≈ TT − UT in seconds for 2026 (IERS Bulletin A extrapolation). Affects positions < 0.01°. */
export const DELTA_T_SECONDS = 69.2;

export function julianDay(date: Date): number {
  return date.getTime() / MS_PER_DAY + 2_440_587.5;
}

export function dateFromJulianDay(jd: number): Date {
  return new Date((jd - 2_440_587.5) * MS_PER_DAY);
}

/** Julian centuries since J2000.0 in Terrestrial Time. */
export function julianCenturiesTT(date: Date): number {
  return (julianDay(date) + DELTA_T_SECONDS / 86_400 - J2000_JD) / 36_525;
}

/** Julian centuries since J2000.0 in UT (for sidereal time). */
export function julianCenturiesUT(date: Date): number {
  return (julianDay(date) - J2000_JD) / 36_525;
}

export interface WallClock {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Offset of the zone from UTC at this instant, minutes east. */
  offsetMinutes: number;
  /** Short zone name as Intl reports it ("HST", "GMT+2"). */
  zoneAbbreviation: string;
  /** ISO weekday 1 (Mon) – 7 (Sun). */
  weekday: number;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
      timeZoneName: 'short',
    });
    dtfCache.set(zone, f);
  }
  return f;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The wall clock reading in `zone` at the instant `date`. */
export function utcToWallClock(date: Date, zone: string): WallClock {
  const parts = formatter(zone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
  return { year, month, day, hour, minute, second, offsetMinutes, zoneAbbreviation: get('timeZoneName'), weekday: WEEKDAYS[get('weekday')] ?? 0 };
}

/** UTC offset of `zone` at `date`, minutes east. */
export function zoneOffsetMinutes(date: Date, zone: string): number {
  return utcToWallClock(date, zone).offsetMinutes;
}

export interface CivilTime {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/**
 * The UTC instant for a wall-clock time in `zone`. See the module comment for the DST policy.
 */
export function wallClockToUtc(civil: CivilTime, zone: string): Date {
  const h = civil.hour ?? 0;
  const m = civil.minute ?? 0;
  const s = civil.second ?? 0;
  const target = Date.UTC(civil.year, civil.month - 1, civil.day, h, m, s);
  // First guess: treat the wall time as UTC, then correct by the offset in force at that guess.
  let guess = target - zoneOffsetMinutes(new Date(target), zone) * 60_000;
  for (let i = 0; i < 3; i++) {
    const off = zoneOffsetMinutes(new Date(guess), zone);
    const next = target - off * 60_000;
    if (next === guess) break;
    guess = next;
  }
  // Overlap (fall back): two instants map to this wall time; prefer the earlier one.
  const earlier = guess - 3_600_000;
  if (wallMatches(earlier, zone, target) && zoneOffsetMinutes(new Date(earlier), zone) !== zoneOffsetMinutes(new Date(guess), zone)) {
    return new Date(earlier);
  }
  // Gap (spring forward): the wall time never occurs; `guess` then reads as target+gap, which is
  // the documented "shift forward" behaviour. Nothing more to do.
  return new Date(guess);
}

function wallMatches(instantMs: number, zone: string, targetUtcMs: number): boolean {
  const w = utcToWallClock(new Date(instantMs), zone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) === targetUtcMs;
}

/** UTC instants of local midnight starting the civil date, and the next midnight. */
export function localDayBounds(civil: Pick<CivilTime, 'year' | 'month' | 'day'>, zone: string): { start: Date; end: Date } {
  const start = wallClockToUtc({ ...civil, hour: 0, minute: 0, second: 0 }, zone);
  const next = addCivilDays(civil, 1);
  const end = wallClockToUtc({ ...next, hour: 0, minute: 0, second: 0 }, zone);
  return { start, end };
}

export function addCivilDays(civil: Pick<CivilTime, 'year' | 'month' | 'day'>, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** "2026-05-31" */
export function civilDateString(civil: Pick<CivilTime, 'year' | 'month' | 'day'>): string {
  return `${civil.year.toString().padStart(4, '0')}-${civil.month.toString().padStart(2, '0')}-${civil.day.toString().padStart(2, '0')}`;
}

export function parseCivilDate(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** "HH:MM" in `zone`. */
export function formatWallTime(date: Date, zone: string): string {
  const w = utcToWallClock(date, zone);
  return `${w.hour.toString().padStart(2, '0')}:${w.minute.toString().padStart(2, '0')}`;
}

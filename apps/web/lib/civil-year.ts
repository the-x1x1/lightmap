/**
 * Civil-year arithmetic for the day-of-year scrubber (plan §44 "scrub through days, months, and
 * seasons"): pure, calendar-only, no zones — a civil date is a date wherever the place is.
 */
import { addCivilDays, civilDateString } from '@lightmap/astronomy';

export interface CivilDay {
  year: number;
  month: number;
  day: number;
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** 1-based day of the year of a civil date (1 Jan = 1). */
export function dayOfYear(c: CivilDay): number {
  return (Date.UTC(c.year, c.month - 1, c.day) - Date.UTC(c.year, 0, 1)) / 86_400_000 + 1;
}

/** The civil date (YYYY-MM-DD) of day `n` (1-based, clamped to the year) of `year`. */
export function dateFromDayOfYear(year: number, n: number): string {
  const clamped = Math.min(daysInYear(year), Math.max(1, Math.round(n)));
  return civilDateString(addCivilDays({ year, month: 1, day: 1 }, clamped - 1));
}

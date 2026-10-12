/**
 * The week ahead (Pro "hour by hour" extended across days): for each of the next civil days the
 * forecast covers, the verdict on its morning and evening golden hours — "Which evening this
 * week?" answered from the same frames and the same `windowOutlook` the day's outlook uses.
 * Pure: the component hands in each day's frames; a day without frames (beyond the horizon, or
 * not fetched yet) is listed with `null` windows so the row says so rather than vanishing.
 */
import {
  addCivilDays,
  civilDateString,
  computeDayEvents,
  moonPosition,
  type DayEvents,
} from '@lightmap/astronomy';
import { windowOutlook, type WeatherFrame, type WindowOutlook } from '@lightmap/weather';

export const WEEK_AHEAD_DAYS = 7;

export interface WeekAheadRow {
  /** Civil date in the planning zone. */
  date: string;
  /** 0 = Sunday, as `Date.getUTCDay()` of the civil date. */
  weekday: number;
  dayEvents: DayEvents;
  morning: { start: Date; end: Date; outlook: WindowOutlook | null } | null;
  evening: { start: Date; end: Date; outlook: WindowOutlook | null } | null;
  /** The Moon that night: lit fraction and whether it is up at local midnight (the night shooter's quick read). */
  moon: { illuminatedFraction: number; upAtMidnight: boolean };
}

/** The civil dates of the week from `from` (inclusive). */
export function weekAheadDates(from: { year: number; month: number; day: number }): string[] {
  return Array.from({ length: WEEK_AHEAD_DAYS }, (_, i) => civilDateString(addCivilDays(from, i)));
}

export function weekAheadRows(
  place: { latitude: number; longitude: number },
  timeZone: string,
  from: { year: number; month: number; day: number },
  framesByDate: ReadonlyMap<string, readonly WeatherFrame[]>,
): WeekAheadRow[] {
  return Array.from({ length: WEEK_AHEAD_DAYS }, (_, i) => {
    const civil = addCivilDays(from, i);
    const date = civilDateString(civil);
    const ev = computeDayEvents({ ...place, timeZone, date: civil });
    const frames = framesByDate.get(date) ?? [];
    const window = (start: Date | null, end: Date | null) =>
      start && end
        ? { start, end, outlook: frames.length ? windowOutlook(frames, start, end) : null }
        : null;
    // Local midnight at the end of this civil day: the Moon over the night that follows.
    const midnight = moonPosition(ev.dayEnd, place.latitude, place.longitude);
    return {
      date,
      weekday: new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).getUTCDay(),
      dayEvents: ev,
      morning: window(ev.goldenHourMorningStart, ev.goldenHourMorningEnd),
      evening: window(ev.goldenHourEveningStart, ev.goldenHourEveningEnd),
      moon: {
        illuminatedFraction: midnight.illuminatedFraction,
        upAtMidnight: midnight.topocentricElevationDeg > 0,
      },
    };
  });
}

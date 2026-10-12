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
  formatWallTime,
  milkyWayWindows,
  moonPosition,
  utcToWallClock,
  type DayEvents,
} from '@lightmap/astronomy';
import {
  windowOutlook,
  type WeatherFrame,
  type WindowOutlook,
  type WindowVerdict,
} from '@lightmap/weather';

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
  /** The night that follows this day has a dark window with the Milky Way core up (`darkNights`). */
  darkSky: boolean;
  /** The forecast over that night's dark window, from this day's frames (null without either). */
  darkOutlook: WindowOutlook | null;
}

/**
 * The civil dates (planning zone) whose following night holds a Milky Way window — the same
 * 30-minute rule as the dark windows list — with the night's window, over the week from `from`. One scan, memoised by
 * the caller: a few tens of milliseconds.
 */
export function darkNights(
  place: { latitude: number; longitude: number },
  timeZone: string,
  from: { year: number; month: number; day: number },
): Map<string, { start: Date; end: Date }> {
  const noon = new Date(
    computeDayEvents({ ...place, timeZone, date: from }).dayStart.getTime() + 12 * 3_600_000,
  );
  const out = new Map<string, { start: Date; end: Date }>();
  for (const w of milkyWayWindows(noon, WEEK_AHEAD_DAYS, place.latitude, place.longitude).windows) {
    // A window after midnight belongs to the evening before it.
    const wall = utcToWallClock(w.start, timeZone);
    const civil = wall.hour < 12 ? addCivilDays(wall, -1) : wall;
    const key = civilDateString(civil);
    // One window per night; the first (the earlier) is kept, its end stretched by any later one.
    const prev = out.get(key);
    if (!prev) out.set(key, { start: w.start, end: w.end });
    else if (w.end.getTime() > prev.end.getTime()) prev.end = w.end;
  }
  return out;
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
  dark: ReadonlyMap<string, { start: Date; end: Date }> = new Map(),
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
      darkSky: dark.has(date),
      darkOutlook: (() => {
        const w = dark.get(date);
        return w && frames.length ? windowOutlook(frames, w.start, w.end) : null;
      })(),
    };
  });
}

/** The verdict in a word or two for a seven-row list. */
export const WEEK_AHEAD_SHORT: Record<WindowVerdict, string> = {
  clear: 'clear',
  thin: 'thin cloud',
  'high-colour': 'high cloud — colour',
  mixed: 'broken cloud',
  clouded: 'clouded out',
};

/**
 * The words after a window's time in the week-ahead table: the verdict with its cloud, or why
 * there is none — the day is beyond the forecast, still loading, or came back without frames.
 */
export function weekAheadCellLabel(
  outlook: Pick<WindowOutlook, 'verdict' | 'meanCloudCover'> | null,
  state: { inForecast: boolean; loading: boolean },
): string {
  if (outlook)
    return `${WEEK_AHEAD_SHORT[outlook.verdict]} (${Math.round(outlook.meanCloudCover)} %)`;
  if (!state.inForecast) return 'beyond the forecast';
  return state.loading ? 'loading…' : 'no forecast';
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The week ahead as plain text for the clipboard — one line per day, in the planning zone. */
export function weekAheadText(
  rows: readonly WeekAheadRow[],
  timeZone: string,
  fetchable: ReadonlySet<string>,
  place: string,
): string {
  const cell = (w: WeekAheadRow['morning'], date: string) =>
    w
      ? `${formatWallTime(w.start, timeZone)} ${weekAheadCellLabel(w.outlook, { inForecast: fetchable.has(date), loading: false })}`
      : '—';
  return [
    `The week ahead at ${place} (times ${timeZone})`,
    ...rows.map(
      (r) =>
        `${WEEKDAY_SHORT[r.weekday] ?? ''} ${r.date}: morning ${cell(r.morning, r.date)} · evening ${cell(r.evening, r.date)} · Moon ${Math.round(r.moon.illuminatedFraction * 100)} %${r.moon.upAtMidnight ? '' : ' (down at midnight)'}${r.darkSky ? ' · Milky Way window' : ''}${r.darkOutlook ? ` (${Math.round(r.darkOutlook.meanCloudCover)} % cloud)` : ''}`,
    ),
    'Cloud over each golden hour from the forecast; beyond the horizon there is none.',
  ].join('\n');
}

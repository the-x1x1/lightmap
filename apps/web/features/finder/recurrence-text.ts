/**
 * Wording for the recurrence chip, kept free of React so it is unit-tested directly. Civil dates
 * are formatted as UTC calendar days: no zone arithmetic, so the label is right for every
 * location including UTC+13/+14, where "noon UTC" would already be tomorrow.
 */
import { civilDateString, formatWallTime, utcToWallClock } from '@lightmap/astronomy';
import type { Recurrence } from './use-next-occurrence.ts';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dayFormatter(withYear: boolean, locale: string | undefined): Intl.DateTimeFormat {
  const key = `${withYear ? 'y' : 'n'}|${locale ?? ''}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
    fmtCache.set(key, f);
  }
  return f;
}

/** "Sat 21 Mar" when in the scene's year, otherwise "Thu 9 Sep 2027". */
export function formatCivilDay(date: string, sceneDate: string, locale?: string): string {
  const withYear = date.slice(0, 4) !== sceneDate.slice(0, 4);
  return dayFormatter(withYear, locale).format(new Date(`${date}T00:00:00Z`));
}

export interface RecurrenceText {
  /** "Like this until Sat 21 Mar", "Like this until at least Sat 21 Mar" (range ran out) or "Last day for this light". */
  lasts: string;
  /** "Thu 9 Sep 2027 (in 168 days)" or null when nothing is in range. */
  back: string | null;
  /** Wall-clock time of the return, "HH:MM". */
  backTime: string | null;
}

export function describeRecurrence(
  r: Pick<Recurrence, 'runEnds' | 'runClipped' | 'next' | 'daysUntilNext'>,
  timeZone: string,
  sceneDate: string,
  locale?: string,
): RecurrenceText {
  const lasts =
    r.runEnds === null
      ? 'Last day for this light'
      : `Like this until ${r.runClipped ? 'at least ' : ''}${formatCivilDay(r.runEnds, sceneDate, locale)}`;
  if (!r.next) return { lasts, back: null, backTime: null };
  const at = new Date(r.next.timestampUtc);
  const backDate = civilDateString(utcToWallClock(at, timeZone));
  const inDays =
    r.daysUntilNext === null
      ? ''
      : r.daysUntilNext === 1
        ? ' (tomorrow)'
        : ` (in ${r.daysUntilNext} days)`;
  return {
    lasts,
    back: `${formatCivilDay(backDate, sceneDate, locale)}${inDays}`,
    backTime: formatWallTime(at, timeZone),
  };
}

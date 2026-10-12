'use client';
/**
 * The week ahead (Pro, entitlement `forecast_detail`): "which evening this week?" — the next
 * seven days' golden hours with the forecast's verdict on each, from the same frames and the
 * same `windowOutlook` the day's hourly outlook uses. Days are fetched only while the block is
 * open (one cached call per day against the plan's weather budget) and only inside the
 * forecast horizon; the rest read "beyond the forecast". A row's time is a jump to that window.
 */
import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  formatWallTime,
  parseCivilDate,
  utcToLocalSelection,
  wallClockToUtc,
} from '@lightmap/astronomy';
import type { EntitlementDecision } from '@lightmap/entitlements';
import { gridKey } from '@lightmap/geospatial';
import type { SceneState } from '@lightmap/scene';
import { decideWeatherMode, type WeatherFrame, type WindowVerdict } from '@lightmap/weather';
import { usePlannerStore } from '@/features/planner/store';
import { useCapabilities } from '@/features/planner/use-scene';
import { weekAheadDates, weekAheadRows } from '@/features/planner/week-ahead';
import { ApiRequestError, fetchJson } from '@/lib/client/api';
import type { WeatherResponse } from '@/lib/api-types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The verdict in a word or two for a seven-row list. */
const SHORT: Record<WindowVerdict, string> = {
  clear: 'clear',
  thin: 'thin cloud',
  'high-colour': 'high cloud — colour',
  mixed: 'broken cloud',
  clouded: 'clouded out',
};

const TONE: Record<WindowVerdict, string> = {
  clear: 'text-[var(--lm-ok)]',
  'high-colour': 'text-[var(--lm-sun)]',
  thin: 'text-[var(--lm-text)]',
  mixed: 'text-[var(--lm-text-muted)]',
  clouded: 'text-[var(--lm-text-muted)]',
};

export function WeekAhead({
  scene,
  decision,
}: {
  scene: SceneState;
  decision: EntitlementDecision;
}) {
  const [open, setOpen] = useState(false);
  const setDate = usePlannerStore((s) => s.setDate);
  const setMinutes = usePlannerStore((s) => s.setMinutes);
  const caps = useCapabilities();
  const tz = scene.timeZone;
  const lat = scene.location.point.latitude;
  const lng = scene.location.point.longitude;
  const cell = gridKey(scene.location.point);
  // From today in the planning zone (not the selected day): the week ahead is about now.
  const today = utcToLocalSelection(new Date(), tz).date;
  const from = useMemo(() => parseCivilDate(today), [today]);
  const dates = useMemo(() => (from ? weekAheadDates(from) : []), [from]);
  const weatherCaps = caps.data?.weather ?? null;
  // Only days the forecast covers are asked for — the route's own horizon rule, probed at local
  // noon (today reads as the recent past once noon has gone; its evening is still a fetch).
  // Seven cheap decisions per render, deliberately not memoised: the clock must stay live.
  const now = new Date();
  const fetchable = dates.filter((d) => {
    const civil = parseCivilDate(d);
    if (!civil) return false;
    const noon = wallClockToUtc({ ...civil, hour: 12, minute: 0, second: 0 }, tz);
    return decideWeatherMode(noon, now, weatherCaps).fetchWorthwhile;
  });
  const results = useQueries({
    queries: fetchable.map((d) => ({
      queryKey: ['weather', cell, d, tz],
      queryFn: () =>
        fetchJson<WeatherResponse>(
          `/api/weather?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&date=${d}&tz=${encodeURIComponent(tz)}`,
        ),
      enabled: open && decision.allowed,
      staleTime: 30 * 60_000,
      gcTime: 6 * 60 * 60_000,
      retry: (count: number, error: unknown) =>
        count < 1 && !(error instanceof ApiRequestError && error.status < 500),
    })),
  });
  const framesByDate = new Map<string, readonly WeatherFrame[]>();
  results.forEach((r, i) => {
    const d = fetchable[i];
    if (d && r.data) framesByDate.set(d, r.data.frames);
  });
  const loading = open && results.some((r) => r.isLoading);
  if (!decision.allowed || !from) return null;
  // Seven days' events and windows are a few milliseconds; the block re-renders only on its own
  // state and the queries, so this is not memoised.
  const rows = weekAheadRows({ latitude: lat, longitude: lng }, tz, from, framesByDate);

  const jump = (at: Date) => {
    const sel = utcToLocalSelection(at, tz);
    setDate(sel.date);
    setMinutes(sel.minutes);
  };
  const cellText = (
    w: {
      start: Date;
      end: Date;
      outlook: { verdict: WindowVerdict; meanCloudCover: number } | null;
    } | null,
    inForecast: boolean,
  ) => {
    if (!w) return <span className="text-[var(--lm-text-faint)]">—</span>;
    const time = (
      <button
        type="button"
        className="font-mono tabular-nums underline decoration-dotted underline-offset-2 hover:text-[var(--lm-text)]"
        title="Jump the planner to the start of this golden hour"
        onClick={() => jump(w.start)}
      >
        {formatWallTime(w.start, tz)}
      </button>
    );
    if (!w.outlook)
      return (
        <>
          {time}{' '}
          <span className="text-[var(--lm-text-faint)]">
            {inForecast ? (loading ? 'loading…' : 'no forecast') : 'beyond the forecast'}
          </span>
        </>
      );
    return (
      <>
        {time}{' '}
        <span className={TONE[w.outlook.verdict]}>
          {SHORT[w.outlook.verdict]} ({Math.round(w.outlook.meanCloudCover)} %)
        </span>
      </>
    );
  };

  return (
    <details
      className="group"
      data-testid="week-ahead"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
        The week ahead
      </summary>
      <table className="mt-2 w-full text-xs" aria-busy={loading || undefined}>
        <caption className="sr-only">
          Golden hours of the next seven days under the forecast
        </caption>
        <thead>
          <tr className="text-left text-[var(--lm-text-muted)]">
            <th scope="col" className="py-0.5 font-normal">
              Day
            </th>
            <th scope="col" className="py-0.5 font-normal">
              Morning
            </th>
            <th scope="col" className="py-0.5 font-normal">
              Evening
            </th>
            <th scope="col" className="py-0.5 text-right font-normal">
              Moon
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const civil = parseCivilDate(r.date);
            const inForecast = fetchable.includes(r.date);
            return (
              <tr key={r.date} className="border-t border-white/5" data-testid="week-ahead-row">
                <th scope="row" className="py-0.5 font-normal">
                  {WEEKDAYS[r.weekday]} {civil?.day} {civil ? MONTHS[civil.month - 1] : ''}
                </th>
                <td className="py-0.5">{cellText(r.morning, inForecast)}</td>
                <td className="py-0.5">{cellText(r.evening, inForecast)}</td>
                <td
                  className="py-0.5 text-right font-mono tabular-nums"
                  title={
                    r.moon.upAtMidnight
                      ? 'Lit fraction; the Moon is up at midnight that night'
                      : 'Lit fraction; the Moon is down at midnight that night'
                  }
                >
                  {Math.round(r.moon.illuminatedFraction * 100)} %{r.moon.upAtMidnight ? '' : ' ↓'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-[var(--lm-text-muted)]">
        Cloud over each golden hour from the forecast; the extended range is low confidence, and
        beyond it there is no forecast to show. Moon: lit fraction that night, ↓ when it is down at
        midnight. Times are local ({tz}).
      </p>
    </details>
  );
}

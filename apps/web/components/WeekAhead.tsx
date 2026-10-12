'use client';
/**
 * The week ahead (Pro, entitlement `forecast_detail`): "which evening this week?" — the next
 * seven days' golden hours with the forecast's verdict on each, from the same frames and the
 * same `windowOutlook` the day's hourly outlook uses. Days are fetched only while the block is
 * open (one cached call per day against the plan's weather budget) and only inside the
 * forecast horizon; the rest read "beyond the forecast". A row's time is a jump to that window.
 */
import { useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  formatWallTime,
  parseCivilDate,
  utcToLocalSelection,
  wallClockToUtc,
} from '@lightmap/astronomy';
import type { EntitlementDecision } from '@lightmap/entitlements';
import type { SceneState } from '@lightmap/scene';
import { decideWeatherMode, type WeatherFrame, type WindowVerdict } from '@lightmap/weather';
import { usePlannerStore } from '@/features/planner/store';
import { useCapabilities } from '@/features/planner/use-scene';
import {
  darkNights,
  weekAheadCellLabel,
  weekAheadDates,
  weekAheadRows,
} from '@/features/planner/week-ahead';
import { weatherQueryOptions } from '@/features/planner/weather-query';
import { Paywall } from './Paywall';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const NO_FRAMES: ReadonlyMap<string, readonly WeatherFrame[]> = new Map();

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
  // From today in the planning zone (not the selected day): the week ahead is about now.
  const today = utcToLocalSelection(new Date(), tz).date;
  const from = useMemo(() => parseCivilDate(today), [today]);
  const dates = useMemo(() => (from ? weekAheadDates(from) : []), [from]);
  // The nights with a Milky Way window (with moon planning): one scan per week, place and zone.
  const hasLunar = scene.lunar !== null;
  const dark = useMemo(
    () =>
      from && hasLunar
        ? darkNights({ latitude: lat, longitude: lng }, tz, from)
        : new Set<string>(),
    [from, hasLunar, lat, lng, tz],
  );
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
      ...weatherQueryOptions(scene.location.point, d, tz),
      enabled: open && decision.allowed,
    })),
  });
  const framesByDate = new Map<string, readonly WeatherFrame[]>();
  results.forEach((r, i) => {
    const d = fetchable[i];
    if (d && r.data) framesByDate.set(d, r.data.frames);
  });
  const loading = open && results.some((r) => r.isLoading);
  // The rows (seven days' events, windows and the Moon) are tens of milliseconds, and the shell
  // re-renders this block on every scrub tick: recompute only when the week, the place, the zone,
  // the dark nights or the fetched days change (the frames are read through a ref so the
  // identity of the per-render map is not a dependency).
  const framesKey = results
    .map((r, i) => `${fetchable[i] ?? ''}:${r.data?.fetchedAt ?? ''}`)
    .join('|');
  const framesRef = useRef({ key: framesKey, map: framesByDate });
  framesRef.current = { key: framesKey, map: framesByDate };
  const rows = useMemo(() => {
    // framesKey names the fetched days the ref holds; it is what makes this memo recompute.
    const frames = framesRef.current.key === framesKey ? framesRef.current.map : NO_FRAMES;
    return from ? weekAheadRows({ latitude: lat, longitude: lng }, tz, from, frames, dark) : [];
  }, [from, lat, lng, tz, dark, framesKey]);
  if (!from) return null;
  // Free and signed-out: the block is named and its reason given (plan §38), never hidden.
  if (!decision.allowed)
    return (
      <details data-testid="week-ahead-locked">
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          The week ahead
          <span className="ml-2 normal-case tracking-normal text-[var(--lm-sun)]">Pro</span>
        </summary>
        <div className="mt-2">
          <Paywall
            compact
            reason={
              decision.reason ??
              'The week ahead — the next seven days’ golden hours under the forecast — is part of Pro.'
            }
          />
        </div>
      </details>
    );

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
    const label = weekAheadCellLabel(w.outlook, { inForecast, loading });
    return (
      <>
        {time}{' '}
        <span className={w.outlook ? TONE[w.outlook.verdict] : 'text-[var(--lm-text-faint)]'}>
          {label}
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
                  {r.darkSky ? '✦ ' : ''}
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
        midnight, ✦ when the night has a dark window for the Milky Way core. Times are local ({tz}).
      </p>
    </details>
  );
}

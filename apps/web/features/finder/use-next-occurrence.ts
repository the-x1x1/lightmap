'use client';
/**
 * "This light" recurrence for the timeline chip (plan §26, roadmap Phase 6): how long the Sun
 * keeps returning to its current direction, and when it comes back after that. The solver runs in
 * the worker with the current Sun position as the target; results are debounced behind the
 * scrubber so dragging the timeline does not queue a search per pixel. Pure astronomy — nothing
 * here touches weather, so it never carries a forecast label.
 */
import { useEffect, useRef, useState } from 'react';
import {
  addCivilDays,
  civilDateString,
  parseCivilDate,
  summarizeRecurrence,
} from '@lightmap/astronomy';
import type { SceneState } from '@lightmap/scene';
import type { SerializedMatch } from './solver-types.ts';
import { useSolver } from './use-solver.ts';

/** Tight enough to mean "the same light", loose enough to survive the 10-minute sampling. */
export const RECURRENCE_TOLERANCE = { azimuthDegrees: 1.5, elevationDegrees: 0.75 } as const;
/** Below civil twilight there is no light to repeat. */
export const RECURRENCE_MIN_ELEVATION_DEG = -6;
/** The Sun returns to any reachable declination within a year; a margin covers the tolerance band. */
export const RECURRENCE_MAX_DAYS = 400;
const DEBOUNCE_MS = 350;

export interface Recurrence {
  /** Last civil date the light still matches (inclusive), or null when it ends with the current day. */
  runEnds: string | null;
  /**
   * The run reached the end of the searched range, so `runEnds` is a lower bound, not the end;
   * with `runEnds === null` it means nothing past today was searched at all.
   */
  runClipped: boolean;
  next: SerializedMatch | null;
  /** Civil days from the scene date to `next`. */
  daysUntilNext: number | null;
  /** The searched range was shortened by the plan window, so `next === null` is not "never". */
  clipped: boolean;
  scannedDays: number;
}

export type RecurrenceState =
  | { status: 'off' }
  | { status: 'searching'; previous: Recurrence | null }
  | { status: 'ready'; value: Recurrence };

export interface UseNextOccurrenceOptions {
  enabled: boolean;
  /** Inclusive last civil date the caller may search (Free window end); null for no clip. */
  lastDate?: string | null;
}

function civilDaysBetween(a: string, b: string): number {
  const pa = parseCivilDate(a);
  const pb = parseCivilDate(b);
  if (!pa || !pb) return 0;
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) /
      86_400_000,
  );
}

export function useNextOccurrence(
  scene: SceneState | null,
  { enabled, lastDate = null }: UseNextOccurrenceOptions,
): RecurrenceState {
  const { run } = useSolver();
  const [state, setState] = useState<RecurrenceState>({ status: 'off' });
  const last = useRef<Recurrence | null>(null);

  const lat = scene?.location.point.latitude;
  const lng = scene?.location.point.longitude;
  const tz = scene?.location.timeZone;
  const date = scene?.localTime.date;
  const az = scene ? Math.round(scene.solar.azimuthDegrees * 100) / 100 : null;
  const el = scene ? Math.round(scene.solar.elevationDegrees * 100) / 100 : null;
  const active =
    enabled &&
    lat !== undefined &&
    lng !== undefined &&
    tz !== undefined &&
    date !== undefined &&
    el !== null &&
    el >= RECURRENCE_MIN_ELEVATION_DEG;

  useEffect(() => {
    if (
      !active ||
      lat === undefined ||
      lng === undefined ||
      !tz ||
      !date ||
      az === null ||
      el === null
    ) {
      last.current = null;
      setState({ status: 'off' });
      return;
    }
    const civil = parseCivilDate(date);
    if (!civil) return;
    let cancelled = false;
    setState({ status: 'searching', previous: last.current });
    const timer = setTimeout(() => {
      const from = addCivilDays(civil, 1);
      let to = addCivilDays(civil, RECURRENCE_MAX_DAYS);
      let clipped = false;
      if (lastDate && civilDateString(to) > lastDate) {
        const clip = parseCivilDate(lastDate);
        if (clip) {
          to = clip;
          clipped = true;
        }
      }
      if (civilDateString(from) > civilDateString(to)) {
        // Nothing searchable inside the window (the scene is already on the window's last day):
        // nothing is known about tomorrow, so the run is marked clipped rather than ended.
        const value: Recurrence = {
          runEnds: null,
          runClipped: true,
          next: null,
          daysUntilNext: null,
          clipped: true,
          scannedDays: 0,
        };
        last.current = value;
        setState({ status: 'ready', value });
        return;
      }
      run({
        latitude: lat,
        longitude: lng,
        timeZone: tz,
        from,
        to,
        body: 'sun',
        target: {
          azimuthDegrees: az,
          elevationDegrees: el,
          azimuthToleranceDegrees: RECURRENCE_TOLERANCE.azimuthDegrees,
          elevationToleranceDegrees: RECURRENCE_TOLERANCE.elevationDegrees,
        },
        minElevationDegrees: RECURRENCE_MIN_ELEVATION_DEG - 1,
        maxDays: RECURRENCE_MAX_DAYS + 1,
      })
        .then(({ result }) => {
          if (cancelled) return;
          const s = summarizeRecurrence(result.matches, from);
          const value: Recurrence = {
            runEnds: s.runEnds,
            runClipped: s.runEnds !== null && s.runEnds === civilDateString(to),
            next: s.next,
            daysUntilNext: s.next ? civilDaysBetween(date, s.next.date) : null,
            clipped,
            scannedDays: result.scannedDays,
          };
          last.current = value;
          setState({ status: 'ready', value });
        })
        .catch(() => {
          // Superseded by a newer search, or the solver rejected the input: keep whatever was
          // shown, or show nothing rather than a placeholder that never resolves.
          if (cancelled) return;
          if (last.current) setState({ status: 'ready', value: last.current });
          else setState({ status: 'off' });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `run` is stable (useCallback with no deps).
  }, [active, lat, lng, tz, date, az, el, lastDate, run]);

  return state;
}

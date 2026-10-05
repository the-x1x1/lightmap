'use client';
/**
 * The planner's product events (plan §31), derived from store transitions in one place rather
 * than sprinkled through components: a place chosen, the timeline scrubbed, a weather scenario
 * picked, the preview expanded. Saves, checkouts and subscriptions are tracked where they happen.
 */
import { useEffect } from 'react';
import { usePlannerStore } from '@/features/planner/store';
import { coarsePlace, setAnalyticsEnabled, track } from '@/lib/client/analytics';

/** A burst of timeline changes counts as one scrub once the slider has rested this long. */
const SCRUB_SETTLE_MS = 1500;

export function useProductEvents(enabled: boolean | undefined): void {
  useEffect(() => {
    setAnalyticsEnabled(enabled === true);
  }, [enabled]);

  useEffect(() => {
    let scrubTimer: ReturnType<typeof setTimeout> | null = null;
    let scrubSteps = 0;
    const unsubscribe = usePlannerStore.subscribe((s, prev) => {
      if (s.location && s.location !== prev.location) {
        // The reverse geocoder re-labelling the same point is not a new selection.
        const samePoint =
          prev.location !== null &&
          prev.location.point.latitude === s.location.point.latitude &&
          prev.location.point.longitude === s.location.point.longitude;
        if (!samePoint)
          track('location_selected', {
            source: s.location.source,
            ...coarsePlace(s.location.point.latitude, s.location.point.longitude),
          });
      }
      // A scrub is the photographer moving the time at the same place; opening a saved viewpoint
      // or switching the time-zone mode moves the date and minutes too, and is not one.
      const samePlace = s.location !== null && s.location === prev.location;
      if (
        samePlace &&
        s.timeZoneMode === prev.timeZoneMode &&
        (s.minutes !== prev.minutes || s.date !== prev.date)
      ) {
        scrubSteps += 1;
        if (scrubTimer) clearTimeout(scrubTimer);
        scrubTimer = setTimeout(() => {
          track('timeline_scrubbed', { steps: scrubSteps });
          scrubSteps = 0;
          scrubTimer = null;
        }, SCRUB_SETTLE_MS);
      }
      if (samePlace && s.forceScenario && s.scenario !== prev.scenario)
        track('weather_scenario_changed', { scenario: s.scenario });
      if (s.previewExpanded && !prev.previewExpanded)
        track('preview_expanded', { camera: s.camera.mode });
    });
    return () => {
      unsubscribe();
      if (scrubTimer) clearTimeout(scrubTimer);
    };
  }, []);
}

'use client';
/**
 * Product analytics on the client (plan §31): a handful of named events, sent as beacons to our
 * own origin, never to a third party. Off until the server says it records them
 * (`capabilities.analytics`), off when the browser asks not to be tracked, and quiet about
 * failures — a lost beacon is nothing the photographer should hear about.
 */
import { quantizeForAnalytics, type AnalyticsEvent } from '@lightmap/observability';

export type AnalyticsProps = Record<string, string | number | boolean>;

const ENDPOINT = '/api/analytics';
let enabled = false;

/** Set from the capabilities response; nothing is sent before that. */
export function setAnalyticsEnabled(on: boolean): void {
  enabled = on;
}

export function analyticsEnabled(): boolean {
  return enabled && !browserOptsOut();
}

/** Do-Not-Track or Global Privacy Control: the visitor asked, so nothing is sent. */
export function browserOptsOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string };
  return n.doNotTrack === '1' || n.globalPrivacyControl === true;
}

/** Record one event. Properties must already be coarse (use `coarsePlace` for coordinates). */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (!analyticsEnabled()) return;
  const body = JSON.stringify({ event, props });
  try {
    if (typeof navigator.sendBeacon === 'function') {
      // A Blob keeps the JSON content type; same-origin, so no preflight is involved.
      if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  } catch {
    // Nothing to do: analytics never surface errors.
  }
}

/** Whole-degree buckets (≈ 110 km) — the only form in which a place may appear in an event. */
export function coarsePlace(latitude: number, longitude: number): AnalyticsProps {
  const q = quantizeForAnalytics(latitude, longitude);
  return { latBucket: q.latBucket, lngBucket: q.lngBucket };
}

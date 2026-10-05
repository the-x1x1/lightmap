'use client';
/**
 * Field mode (roadmap Phase 9): point the phone like a camera and the viewpoint camera follows
 * its back camera — heading from the compass, pitch from the tilt. Opt-in per use; iOS asks for
 * permission on the first tap. Readings are smoothed and throttled so the globe is not re-aimed
 * sixty times a second.
 *
 * One follow per page: the controller is a module-level singleton (the "Point with phone" button
 * and the field view drive the same one), exposed to React through `useSyncExternalStore`.
 * Hiding the page pauses the follow and showing it again resumes it.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { blendHeading, cameraPointingFromOrientation, clampPitch } from '@lightmap/scene';
import { usePlannerStore } from '@/features/planner/store';

/** 'no-compass': events arrive but carry no compass reference (desktop browsers, some Android builds). */
export type CompassState =
  'unsupported' | 'idle' | 'requesting' | 'active' | 'denied' | 'no-compass';

interface OrientationEventLike extends Event {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number | null;
}

type RequestPermission = () => Promise<string>;

/** Secure context + the event exists. Whether readings carry a compass is only known once they arrive. */
export function compassSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof (window as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent === 'function'
  );
}

/** Share of the new reading per update: steady enough to read, quick enough to follow a pan. */
const SMOOTHING = 0.35;
const MIN_INTERVAL_MS = 80;
/** Give up on the compass when no usable reading arrives in this long. */
const SILENCE_MS = 2500;

const listeners = new Set<() => void>();
let state: CompassState = 'idle';
let active = false;
/** True while the controller itself writes the camera, so the manual-input watcher ignores it. */
let writing = false;
/** The follow was interrupted by the page being hidden and should resume when it is shown. */
let pausedByHide = false;
let generation = 0;
let last: { t: number; heading: number; pitch: number; roll: number } | null = null;
/** Smoothed roll of the phone about its line of sight (field view only; the planner camera has no roll). */
let rollDeg = 0;
let silence: ReturnType<typeof setTimeout> | null = null;
let detach: () => void = () => {};
let unsubscribeStore: () => void = () => {};
let pageHooksInstalled = false;

function setState(next: CompassState): void {
  if (state === next) return;
  state = next;
  notify();
}

function notify(): void {
  for (const l of listeners) l();
}

function stop(): void {
  active = false;
  detach();
  detach = () => {};
  unsubscribeStore();
  unsubscribeStore = () => {};
  if (silence) clearTimeout(silence);
  silence = null;
  last = null;
  if (rollDeg !== 0) {
    rollDeg = 0;
    notify();
  }
  if (state !== 'unsupported') setState('idle');
}

function armSilence(): void {
  if (silence) clearTimeout(silence);
  silence = setTimeout(() => {
    if (active) {
      stop();
      setState('no-compass');
    }
  }, SILENCE_MS);
}

function onReading(e: Event): void {
  if (!active) return;
  const o = e as OrientationEventLike;
  const pointing = cameraPointingFromOrientation({
    alpha: o.alpha ?? Number.NaN,
    beta: o.beta ?? Number.NaN,
    gamma: o.gamma ?? Number.NaN,
    absolute: o.absolute ?? (e.type === 'deviceorientationabsolute' ? true : null),
    webkitCompassHeading: o.webkitCompassHeading ?? null,
  });
  if (!pointing) return;
  armSilence();
  const now = performance.now();
  const prev = last;
  if (prev && now - prev.t < MIN_INTERVAL_MS) return;
  const heading = prev
    ? blendHeading(prev.heading, pointing.headingDeg, SMOOTHING)
    : pointing.headingDeg;
  const pitch = prev
    ? prev.pitch + (pointing.pitchDeg - prev.pitch) * SMOOTHING
    : pointing.pitchDeg;
  const roll = prev ? blendRoll(prev.roll, pointing.rollDeg, SMOOTHING) : pointing.rollDeg;
  last = { t: now, heading, pitch, roll };
  const store = usePlannerStore.getState();
  writing = true;
  try {
    store.setHeading(heading);
    store.setPitch(clampPitch(pitch, -60, 60));
  } finally {
    writing = false;
  }
  if (Math.abs(roll - rollDeg) > 0.05) {
    rollDeg = roll;
    notify();
  }
  setState('active');
}

/** Roll is −180…180: blend on the circle so −179 → 179 does not swing through 0. */
function blendRoll(prevDeg: number, nextDeg: number, weight: number): number {
  const h = blendHeading(prevDeg, nextDeg, weight);
  return h > 180 ? h - 360 : h;
}

function attach(): void {
  detach(); // idempotent: a second attach (Strict Mode, a late permission promise) never doubles up
  // Android exposes a compass-referenced stream under its own name; iOS puts the compass heading
  // on the plain event. Listen to both; the maths ignores readings without a reference.
  window.addEventListener('deviceorientationabsolute', onReading);
  window.addEventListener('deviceorientation', onReading);
  detach = () => {
    window.removeEventListener('deviceorientationabsolute', onReading);
    window.removeEventListener('deviceorientation', onReading);
  };
  armSilence();
}

/**
 * Any manual camera input ends the follow (the photographer took over); so does leaving viewpoint
 * mode or clearing the place.
 */
function watchStore(): void {
  unsubscribeStore();
  unsubscribeStore = usePlannerStore.subscribe((s, prev) => {
    if (!active || writing) return;
    if (s.camera.mode !== 'viewpoint' || (prev.location !== s.location && s.location === null)) {
      stop();
      return;
    }
    if (
      last &&
      (s.camera.headingDeg !== prev.camera.headingDeg || s.camera.pitchDeg !== prev.camera.pitchDeg)
    )
      stop();
  });
}

function installPageHooks(): void {
  if (pageHooksInstalled || typeof document === 'undefined') return;
  pageHooksInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (active) {
        stop();
        pausedByHide = true;
      }
    } else if (pausedByHide) {
      pausedByHide = false;
      start();
    }
  });
}

function start(): void {
  if (!compassSupported()) {
    setState('unsupported');
    return;
  }
  if (active) return;
  installPageHooks();
  active = true;
  pausedByHide = false;
  last = null;
  const gen = ++generation;
  usePlannerStore.getState().setCameraMode('viewpoint');
  watchStore();
  const ctor = window.DeviceOrientationEvent as unknown as {
    requestPermission?: RequestPermission;
  };
  setState('requesting');
  if (typeof ctor.requestPermission === 'function') {
    ctor
      .requestPermission()
      .then((r) => {
        if (!active || gen !== generation) return;
        if (r === 'granted') attach();
        else {
          stop();
          setState('denied');
        }
      })
      .catch(() => {
        if (!active || gen !== generation) return;
        stop();
        setState('denied');
      });
  } else {
    attach();
  }
}

/** The single page-wide compass follow. */
export const compassController = {
  start,
  stop,
  getState: (): CompassState => state,
  getRollDeg: (): number => rollDeg,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

const getServerState = (): CompassState => 'idle';
const getServerRoll = (): number => 0;

export function useCompass(): {
  state: CompassState;
  /** Phone roll about the line of sight while following, degrees (right edge down = positive). */
  rollDeg: number;
  start: () => void;
  stop: () => void;
} {
  const current = useSyncExternalStore(
    compassController.subscribe,
    compassController.getState,
    getServerState,
  );
  const roll = useSyncExternalStore(
    compassController.subscribe,
    compassController.getRollDeg,
    getServerRoll,
  );
  const startCb = useCallback(() => compassController.start(), []);
  const stopCb = useCallback(() => compassController.stop(), []);
  // Before the first start the controller does not know whether the device qualifies.
  const resolved: CompassState =
    current === 'idle' && typeof window !== 'undefined' && !compassSupported()
      ? 'unsupported'
      : current;
  return { state: resolved, rollDeg: roll, start: startCb, stop: stopCb };
}

'use client';
/**
 * Field mode (roadmap Phase 9): point the phone like a camera and the viewpoint camera follows
 * its back camera — heading from the compass, pitch from the tilt. Opt-in per use; iOS asks for
 * permission on the first tap. Readings are smoothed and throttled so the globe is not re-aimed
 * sixty times a second.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { blendHeading, cameraPointingFromOrientation, clampPitch } from '@lightmap/scene';
import { usePlannerStore } from '@/features/planner/store';

/** 'no-compass': events arrive but carry no compass reference (desktop browsers, some Android builds). */
export type CompassState =
  | 'unsupported'
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'no-compass';

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

export function useCompass(): { state: CompassState; start: () => void; stop: () => void } {
  const [state, setState] = useState<CompassState>(() =>
    compassSupported() ? 'idle' : 'unsupported',
  );
  const active = useRef(false);
  const last = useRef<{ t: number; heading: number; pitch: number } | null>(null);
  /** True while this hook itself writes the camera, so the manual-input watcher ignores it. */
  const writing = useRef(false);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detach = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    active.current = false;
    detach.current();
    detach.current = () => {};
    if (silence.current) clearTimeout(silence.current);
    silence.current = null;
    last.current = null;
    setState((s) => (s === 'unsupported' ? s : 'idle'));
  }, []);

  const attach = useCallback(() => {
    const onReading = (e: Event) => {
      if (!active.current) return;
      const o = e as OrientationEventLike;
      const pointing = cameraPointingFromOrientation({
        alpha: o.alpha ?? Number.NaN,
        beta: o.beta ?? Number.NaN,
        gamma: o.gamma ?? Number.NaN,
        absolute: o.absolute ?? (e.type === 'deviceorientationabsolute' ? true : null),
        webkitCompassHeading: o.webkitCompassHeading ?? null,
      });
      if (!pointing) return;
      if (silence.current) clearTimeout(silence.current);
      silence.current = setTimeout(() => {
        if (active.current) {
          stop();
          setState('no-compass');
        }
      }, SILENCE_MS);
      const now = performance.now();
      const prev = last.current;
      if (prev && now - prev.t < MIN_INTERVAL_MS) return;
      const heading = prev
        ? blendHeading(prev.heading, pointing.headingDeg, SMOOTHING)
        : pointing.headingDeg;
      const pitch = prev
        ? prev.pitch + (pointing.pitchDeg - prev.pitch) * SMOOTHING
        : pointing.pitchDeg;
      last.current = { t: now, heading, pitch };
      const store = usePlannerStore.getState();
      writing.current = true;
      try {
        store.setHeading(heading);
        store.setPitch(clampPitch(pitch, -60, 60));
      } finally {
        writing.current = false;
      }
      setState('active');
    };
    // Android exposes a compass-referenced stream under its own name; iOS puts the compass heading
    // on the plain event. Listen to both; the maths ignores readings without a reference.
    window.addEventListener('deviceorientationabsolute', onReading);
    window.addEventListener('deviceorientation', onReading);
    detach.current = () => {
      window.removeEventListener('deviceorientationabsolute', onReading);
      window.removeEventListener('deviceorientation', onReading);
    };
    silence.current = setTimeout(() => {
      if (active.current) {
        stop();
        setState('no-compass');
      }
    }, SILENCE_MS);
  }, [stop]);

  const start = useCallback(() => {
    if (!compassSupported() || active.current) return;
    active.current = true;
    last.current = null;
    usePlannerStore.getState().setCameraMode('viewpoint');
    const ctor = window.DeviceOrientationEvent as unknown as {
      requestPermission?: RequestPermission;
    };
    if (typeof ctor.requestPermission === 'function') {
      setState('requesting');
      ctor
        .requestPermission()
        .then((r) => {
          if (!active.current) return;
          if (r === 'granted') attach();
          else {
            active.current = false;
            setState('denied');
          }
        })
        .catch(() => {
          if (!active.current) return;
          active.current = false;
          setState('denied');
        });
    } else {
      setState('requesting');
      attach();
    }
  }, [attach]);

  // Any manual camera input ends the follow (the photographer took over); so does leaving
  // viewpoint mode, clearing the place, or hiding the page.
  useEffect(() => {
    const unsub = usePlannerStore.subscribe((s, prev) => {
      if (!active.current || writing.current) return;
      if (s.camera.mode !== 'viewpoint' || (prev.location !== s.location && s.location === null)) {
        stop();
        return;
      }
      if (
        last.current &&
        (s.camera.headingDeg !== prev.camera.headingDeg ||
          s.camera.pitchDeg !== prev.camera.pitchDeg)
      )
        stop();
    });
    const onHide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onHide);
      stop();
    };
  }, [stop]);

  return { state, start, stop };
}

'use client';
/**
 * Field view (roadmap Phase 9 "AR sun alignment"): the phone's live camera behind the planned
 * sun and moon, the sun's path for the day, true level and the modelled skyline — so you can stand
 * at the spot, hold the phone up like a camera and see where the light will be at the planned
 * time. The camera frames never leave the device: nothing is captured, stored or sent.
 *
 * Heading and pitch come from the compass (`useCompass`); the feed's field of view starts at a
 * sensible default for a phone's main camera and can be nudged until the frame matches the eye.
 */
import { useEffect, useRef, useState } from 'react';
import { formatWallTime } from '@lightmap/astronomy';
import {
  defaultCameraFeedFovDeg,
  edgeIndicator,
  frameCoordinates,
  levelLineSegment,
  skylinePath,
  sunPathInFrame,
} from '@lightmap/scene';
import type { SceneState } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { usePlannerStore } from '@/features/planner/store';
import { compassSupported, useCompass } from '@/features/field/use-compass';
import { Button } from '@lightmap/ui';

/**
 * A phone (coarse pointer + compass) in a secure context with a camera API. Whether a camera
 * exists is only known when it is asked for; a laptop webcam without a compass is not useful here.
 */
export function fieldViewSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    compassSupported() &&
    (typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false)
  );
}

/** Frame coordinates (−1…1, y up) → SVG units: the viewBox is `100·aspect` wide and 100 tall, so circles stay round. */
const sy = (y: number) => ((1 - y) / 2) * 100;
/** Percent of the box, for HTML overlays. */
const px = (x: number) => ((x + 1) / 2) * 100;

type CameraStatus = 'starting' | 'live' | 'denied' | 'unavailable';

export function FieldView({ scene, onClose }: { scene: SceneState; onClose: () => void }) {
  const camera = usePlannerStore((s) => s.camera);
  const profile = usePlannerStore((s) => s.horizonProfile);
  const setNow = usePlannerStore((s) => s.setNow);
  const rotateCamera = usePlannerStore((s) => s.rotateCamera);
  const { start, stop, state: compassState, rollDeg } = useCompass();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // `onClose` is an inline callback from the shell; keep it out of effect deps.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const feedSize = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [video, setVideo] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [host, setHost] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [fovDeg, setFovDeg] = useState<number | null>(null);

  // The camera feed: back camera, no audio, released on close.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const media = navigator.mediaDevices as MediaDevices | undefined;
    if (typeof media?.getUserMedia !== 'function') {
      setStatus('unavailable');
      return;
    }
    media
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const el = videoRef.current;
        if (!el) return;
        el.srcObject = s;
        el.play().catch(() => {
          /* autoplay is allowed for muted video; a refusal just leaves the first frame */
        });
        setStatus('live');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        setStatus(
          name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
        );
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // The feed's own aspect sets the overlay box; the host's size sets how it is letterboxed.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => setHost({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow the phone from the moment the view opens; stop when it closes. Focus lands on Close
  // and Escape closes (the planner behind is covered, not inert).
  useEffect(() => {
    start();
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stop();
    };
  }, [start, stop]);

  // Feed dimensions: on metadata and on every `resize` (device rotation swaps width and height;
  // the FOV default flips between the long and the short side with it).
  const onFeedSize = () => {
    const el = videoRef.current;
    if (!el || !(el.videoWidth > 0) || !(el.videoHeight > 0)) return;
    const w = el.videoWidth;
    const h = el.videoHeight;
    const prev = feedSize.current;
    if (prev.w === w && prev.h === h) return;
    const flipped = prev.w > 0 && prev.w >= prev.h !== w >= h;
    feedSize.current = { w, h };
    setVideo({ w, h });
    if (prev.w === 0 || flipped) setFovDeg(defaultCameraFeedFovDeg(w, h));
  };

  // Letterbox: the largest box of the video's aspect that fits the host.
  const aspect =
    video.w > 0 && video.h > 0
      ? video.w / video.h
      : host.w > 0 && host.h > 0
        ? host.w / host.h
        : 3 / 4;
  const box =
    host.w > 0 && host.h > 0
      ? host.w / host.h > aspect
        ? { w: host.h * aspect, h: host.h }
        : { w: host.w, h: host.w / aspect }
      : { w: 0, h: 0 };
  const fov = fovDeg ?? defaultCameraFeedFovDeg(video.w, video.h);
  const frame = { headingDeg: camera.headingDeg, pitchDeg: camera.pitchDeg, fovDeg: fov };
  // SVG units: width 100·aspect, height 100, so a circle of radius r is round on screen.
  const W = 100 * aspect;
  const sx = (x: number) => ((x + 1) / 2) * W;
  const pts = (list: ReadonlyArray<{ x: number; y: number }>) =>
    list.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ');

  const inFrame = (p: { x: number; y: number } | null) =>
    p !== null && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 ? p : null;
  // The same refracted elevation the path uses, so the marker sits on its own path.
  const sunUp = scene.solar.isAboveHorizon;
  const sunEl = scene.solar.apparentElevationDegrees;
  // The phone's roll tilts every mark the other way; the planner camera itself has no roll.
  const roll = compassState === 'active' ? rollDeg : 0;
  const sun = sunUp
    ? inFrame(frameCoordinates(frame, scene.solar.azimuthDegrees, sunEl, aspect, roll))
    : null;
  const sunEdge = sunUp
    ? edgeIndicator(frame, scene.solar.azimuthDegrees, sunEl, aspect, roll)
    : null;
  const moon = scene.lunar?.isAboveHorizon
    ? inFrame(
        frameCoordinates(
          frame,
          scene.lunar.azimuthDegrees,
          scene.lunar.elevationDegrees,
          aspect,
          roll,
        ),
      )
    : null;
  const path = sunPathInFrame(
    frame,
    scene.location.point,
    scene.dayEvents.dayStart,
    scene.dayEvents.dayEnd,
    { stepMinutes: 10, aspect, rollDeg: roll },
  );
  const level = levelLineSegment(frame, aspect, roll);
  const sky = profile ? skylinePath(frame, profile, aspect, 48, roll) : [];
  const tz = scene.location.timeZone;

  const cameraNote =
    status === 'denied'
      ? 'Camera access was not allowed — marks over a dark frame.'
      : status === 'unavailable'
        ? 'No camera available here — marks over a dark frame.'
        : '';
  const compassNote =
    compassState === 'no-compass'
      ? 'No compass heading from this device: aim with the arrows below.'
      : compassState === 'denied'
        ? 'Motion & orientation access was not allowed: aim with the arrows below.'
        : compassState === 'idle'
          ? 'Not following the phone (you took over). Tap "Follow phone" to resume.'
          : compassState === 'requesting'
            ? 'Hold the phone up like a camera…'
            : '';
  const statusText = [cameraNote, compassNote].filter(Boolean).join(' ');
  const nudge = (dh: number, dp: number) => rotateCamera(dh, dp);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black text-[var(--lm-text)]"
      role="dialog"
      aria-modal="true"
      aria-label="Field view"
      data-testid="field-view"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <div className="min-w-0 text-sm">
          <div className="truncate font-medium">{scene.location.label}</div>
          <div className="text-xs text-[var(--lm-text-muted)]" data-testid="field-view-time">
            {formatWallTime(scene.utc, tz)} · {scene.localTime.date} ·{' '}
            {sunUp
              ? `sun ${Math.round(scene.solar.azimuthDegrees)}° ${compassLabel(scene.solar.azimuthDegrees)}, ${Math.round(sunEl)}° up`
              : `sun ${Math.abs(Math.round(sunEl))}° below the horizon`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setNow(tz)}
            data-testid="field-view-now"
          >
            Now
          </Button>
          <Button
            ref={closeRef}
            size="sm"
            variant="secondary"
            onClick={onClose}
            data-testid="field-view-close"
          >
            Close
          </Button>
        </div>
      </div>

      <div ref={hostRef} className="relative min-h-0 flex-1">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-[#111]"
          style={{ width: box.w, height: box.h }}
        >
          <video
            ref={videoRef}
            className="h-full w-full object-fill"
            playsInline
            muted
            autoPlay
            onLoadedMetadata={onFeedSize}
            onResize={onFeedSize}
            aria-hidden
          />
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${W.toFixed(3)} 100`}
            preserveAspectRatio="none"
            aria-hidden
            data-testid="field-view-marks"
          >
            {[1 / 3, 2 / 3].map((f) => (
              <g key={f} stroke="rgba(255,255,255,0.18)" strokeWidth={1}>
                <line x1={W * f} y1={0} x2={W * f} y2={100} vectorEffect="non-scaling-stroke" />
                <line x1={0} y1={100 * f} x2={W} y2={100 * f} vectorEffect="non-scaling-stroke" />
              </g>
            ))}
            {sky.length ? (
              <polyline
                points={pts(sky)}
                fill="none"
                stroke="var(--lm-sun)"
                strokeOpacity={0.7}
                strokeWidth={1.5}
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {level ? (
              <line
                x1={sx(level.x1)}
                x2={sx(level.x2)}
                y1={sy(level.y1)}
                y2={sy(level.y2)}
                stroke="white"
                strokeOpacity={0.8}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {path.map((run, i) => (
              <polyline
                key={i}
                points={pts(run)}
                fill="none"
                stroke="var(--lm-sun)"
                strokeOpacity={0.8}
                strokeWidth={2}
                strokeDasharray="1 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {moon ? (
              <circle
                cx={sx(moon.x)}
                cy={sy(moon.y)}
                r={1.6}
                fill="rgba(230,235,255,0.9)"
                stroke="rgba(0,0,0,0.6)"
                strokeWidth={0.4}
                data-testid="field-view-moon"
              />
            ) : null}
            {sun ? (
              <g data-testid="field-view-sun">
                <circle
                  cx={sx(sun.x)}
                  cy={sy(sun.y)}
                  r={3.2}
                  fill="var(--lm-sun)"
                  fillOpacity={0.35}
                />
                <circle cx={sx(sun.x)} cy={sy(sun.y)} r={1.8} fill="var(--lm-sun)" />
              </g>
            ) : null}
          </svg>
          {sunUp && sunEdge ? (
            <div
              className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-[var(--lm-sun)]"
              style={{
                left: `${Math.min(92, Math.max(8, px(sunEdge.x)))}%`,
                top: `${Math.min(90, Math.max(10, sy(sunEdge.y)))}%`,
              }}
              data-testid="field-view-sun-edge"
            >
              <span
                aria-hidden
                className="block text-3xl leading-none"
                style={{ transform: `rotate(${sunEdge.angleDeg}deg)` }}
              >
                ↑
              </span>
              <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px]">
                sun {Math.abs(Math.round(sunEdge.turnRightDeg))}°{' '}
                {sunEdge.turnRightDeg >= 0 ? 'right' : 'left'}
                {Math.abs(sunEdge.tiltUpDeg) > 5
                  ? `, ${Math.abs(Math.round(sunEdge.tiltUpDeg))}° ${sunEdge.tiltUpDeg > 0 ? 'up' : 'down'}`
                  : ''}
              </span>
            </div>
          ) : null}
        </div>
        {statusText ? (
          <p
            role="status"
            className="absolute left-1/2 top-2 max-w-[90%] -translate-x-1/2 rounded-2xl bg-black/70 px-3 py-1.5 text-center text-xs"
            data-testid="field-view-status"
          >
            {statusText}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 text-xs">
        <div className="flex items-center gap-1" role="group" aria-label="Aim the camera">
          <Button
            size="sm"
            variant="secondary"
            aria-label="Turn left 5 degrees"
            onClick={() => nudge(-5, 0)}
          >
            ◀
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label="Turn right 5 degrees"
            onClick={() => nudge(5, 0)}
          >
            ▶
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label="Tilt up 5 degrees"
            onClick={() => nudge(0, 5)}
          >
            ▲
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label="Tilt down 5 degrees"
            onClick={() => nudge(0, -5)}
          >
            ▼
          </Button>
          {compassState === 'idle' || compassState === 'no-compass' || compassState === 'denied' ? (
            <Button size="sm" variant="secondary" onClick={start} data-testid="field-view-follow">
              Follow phone
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Camera field of view">
          <Button
            size="sm"
            variant="secondary"
            aria-label="Narrower field of view"
            onClick={() => setFovDeg(Math.max(20, fov - 3))}
            data-testid="field-view-fov-narrow"
          >
            −
          </Button>
          <span className="tabular-nums" data-testid="field-view-fov">
            {Math.round(fov)}° wide
          </span>
          <Button
            size="sm"
            variant="secondary"
            aria-label="Wider field of view"
            onClick={() => setFovDeg(Math.min(120, fov + 3))}
            data-testid="field-view-fov-wide"
          >
            +
          </Button>
        </div>
        <p className="w-full text-[11px] text-[var(--lm-text-muted)]">
          Heading {Math.round(camera.headingDeg)}° {compassLabel(camera.headingDeg)} · pitch{' '}
          {Math.round(camera.pitchDeg)}°{roll ? ` · roll ${Math.round(roll)}°` : ''}. Nudge the
          field of view until the horizon and real objects sit where they do in the feed. Dotted:
          the sun&rsquo;s path today; white line: true level; terrain line: modelled ridge (terrain
          only). The camera picture never leaves this phone.
        </p>
      </div>
    </div>
  );
}

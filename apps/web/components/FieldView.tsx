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
  levelLineY,
  skylinePath,
  sunPathInFrame,
} from '@lightmap/scene';
import type { SceneState } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { usePlannerStore } from '@/features/planner/store';
import { useCompass } from '@/features/field/use-compass';
import { Button } from '@lightmap/ui';

/** Secure context with a camera API. Whether a camera exists is only known when it is asked for. */
export function fieldViewSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** Frame coordinates (−1…1, y up) → percent of the video box (y down). */
const sx = (x: number) => ((x + 1) / 2) * 100;
const sy = (y: number) => ((1 - y) / 2) * 100;

type CameraStatus = 'starting' | 'live' | 'denied' | 'unavailable';

export function FieldView({ scene, onClose }: { scene: SceneState; onClose: () => void }) {
  const camera = usePlannerStore((s) => s.camera);
  const profile = usePlannerStore((s) => s.horizonProfile);
  const setNow = usePlannerStore((s) => s.setNow);
  const compass = useCompass();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
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

  // Follow the phone from the moment the view opens; stop when it closes.
  const { start, stop, state: compassState } = compass;
  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  const onMeta = () => {
    const el = videoRef.current;
    if (!el) return;
    setVideo({ w: el.videoWidth, h: el.videoHeight });
    setFovDeg((f) => f ?? defaultCameraFeedFovDeg(el.videoWidth, el.videoHeight));
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

  const inFrame = (p: { x: number; y: number } | null) =>
    p !== null && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 ? p : null;
  const sunUp = scene.solar.elevationDegrees > -0.833;
  const sun = sunUp
    ? inFrame(
        frameCoordinates(frame, scene.solar.azimuthDegrees, scene.solar.elevationDegrees, aspect),
      )
    : null;
  const sunEdge = sunUp
    ? edgeIndicator(frame, scene.solar.azimuthDegrees, scene.solar.elevationDegrees, aspect)
    : null;
  const moon = scene.lunar?.isAboveHorizon
    ? inFrame(
        frameCoordinates(frame, scene.lunar.azimuthDegrees, scene.lunar.elevationDegrees, aspect),
      )
    : null;
  const path = sunPathInFrame(
    frame,
    scene.location.point,
    scene.dayEvents.dayStart,
    scene.dayEvents.dayEnd,
    { stepMinutes: 10, aspect },
  );
  const levelY = levelLineY(frame, aspect);
  const sky = profile ? skylinePath(frame, profile, aspect) : [];
  const tz = scene.location.timeZone;

  const statusText =
    status === 'denied'
      ? 'Camera access was not allowed. The marks still follow the compass over a dark frame.'
      : status === 'unavailable'
        ? 'No camera is available here. The marks still follow the compass.'
        : compassState === 'no-compass'
          ? 'This device gives no compass heading; turn the camera with the heading slider instead.'
          : compassState === 'denied'
            ? 'Motion & orientation access was not allowed; the heading slider still works.'
            : '';

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
              ? `sun ${Math.round(scene.solar.azimuthDegrees)}° ${compassLabel(scene.solar.azimuthDegrees)}, ${Math.round(scene.solar.elevationDegrees)}° up`
              : `sun ${Math.abs(Math.round(scene.solar.elevationDegrees))}° below the horizon`}
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
          <Button size="sm" variant="secondary" onClick={onClose} data-testid="field-view-close">
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
            onLoadedMetadata={onMeta}
            aria-hidden
          />
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
            data-testid="field-view-marks"
          >
            {[100 / 3, 200 / 3].map((v) => (
              <g key={v} stroke="rgba(255,255,255,0.18)" strokeWidth={1}>
                <line x1={v} y1={0} x2={v} y2={100} vectorEffect="non-scaling-stroke" />
                <line x1={0} y1={v} x2={100} y2={v} vectorEffect="non-scaling-stroke" />
              </g>
            ))}
            {sky.length ? (
              <polyline
                points={sky.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ')}
                fill="none"
                stroke="var(--lm-sun)"
                strokeOpacity={0.7}
                strokeWidth={1.5}
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {levelY !== null ? (
              <line
                x1={0}
                x2={100}
                y1={sy(levelY)}
                y2={sy(levelY)}
                stroke="white"
                strokeOpacity={0.8}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {path.map((run, i) => (
              <polyline
                key={i}
                points={run.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ')}
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
                left: `${Math.min(94, Math.max(6, sx(sunEdge.x)))}%`,
                top: `${Math.min(92, Math.max(8, sy(sunEdge.y)))}%`,
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
        <div className="text-[var(--lm-text-muted)]">
          Heading {Math.round(camera.headingDeg)}° {compassLabel(camera.headingDeg)} · pitch{' '}
          {Math.round(camera.pitchDeg)}°
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
          Nudge the field of view until the horizon and real objects sit where they do in the feed.
          Dotted: the sun&rsquo;s path today; white line: true level; terrain line: modelled ridge
          (terrain only). The camera picture never leaves this phone.
        </p>
      </div>
    </div>
  );
}

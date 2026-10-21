'use client';
/**
 * WorldMap: the Cesium globe (Quality 1+) with the Quality-0 overlay always available on top.
 * Click/tap sets the pin. In viewpoint mode a drag looks around (heading/pitch) and a click
 * (a press that does not move) walks the viewpoint to the ground under it, keeping the heading.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { directionFromFrame, frameCoordinates } from '@lightmap/scene';
import { usePlannerStore } from '@/features/planner/store';
import { useApplyScene, useRenderer } from '@/features/map/use-renderer';
import { api } from '@/lib/client/api';
import type { CapabilitiesResponse, ReverseResponse } from '@/lib/api-types';
import type { SceneState } from '@lightmap/scene';
import { destinationPoint, type GeoPoint } from '@lightmap/geospatial';
import type { HostStats, RendererCapabilities } from '@lightmap/renderer';
import { SunDirectionOverlay } from './SunDirectionOverlay';
import { SkyBackdrop } from './SkyBackdrop';
import { LevelGuide } from './LevelGuide';
import { EmptyState } from './states/EmptyState';
import { cx } from '@lightmap/ui';
import { provisionalTimeZone, samePoint } from '@/features/planner/provisional-zone';
import { WALK_TICK_MS, easeFovToward, walkStep, wheelZoomGoal } from '@/features/map/view-input';

export interface RendererInfo {
  mode: '3D' | 'OVERLAY' | 'loading';
  qualityLabel: string;
  /** Polled, not pushed: call when a panel wants numbers. */
  getStats: () => HostStats | null;
  error: string | null;
  capabilities: RendererCapabilities | null;
  /** JPEG data URL of the current frame, downscaled to `maxWidth` (default 320 for thumbnails). */
  capture: (maxWidth?: number) => Promise<string | null>;
  /** Terrain heights at a tile level, for the terrain horizon; null when no host is running. */
  sampleHeights:
    ((points: readonly GeoPoint[], level: number) => Promise<Array<number | null>>) | null;
  /** Terrain-or-building heights from the loaded 3D buildings; null without a host. */
  sampleSurface: ((points: readonly GeoPoint[]) => Promise<Array<number | null> | null>) | null;
}

export interface WorldMapProps {
  scene: SceneState | null;
  capabilities: CapabilitiesResponse | null;
  onRendererInfo?: (info: RendererInfo) => void;
  className?: string;
}

/** A held arrow key turns the view this fast (degrees a second; Shift: three times). */
const TURN_DEG_PER_S = 45;
/** How long an arrow key is held before the smooth turn takes over from the single step. */
const TURN_HOLD_MS = 280;

export function WorldMap({ scene, capabilities, onRendererInfo, className }: WorldMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const credits = useRef<HTMLDivElement | null>(null);
  const setLocation = usePlannerStore((s) => s.setLocation);
  const location = usePlannerStore((s) => s.location);
  const camera = usePlannerStore((s) => s.camera);
  const rotateCamera = usePlannerStore((s) => s.rotateCamera);
  const finderPicking = usePlannerStore((s) => s.finderPicking);
  const finderTarget = usePlannerStore((s) => s.finderTarget);
  const setFinderTarget = usePlannerStore((s) => s.setFinderTarget);
  const showLevelGuide = usePlannerStore((s) => s.showLevelGuide);
  const setViewportAspect = usePlannerStore((s) => s.setViewportAspect);
  // The panel's frame maths (level guide placements) need the viewport's aspect ratio.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const update = () => {
      if (el.clientHeight > 0) setViewportAspect(el.clientWidth / el.clientHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewportAspect]);
  const setQualityFromGovernor = useRef<
    (q: {
      shadowMapSize: 1024 | 2048 | 4096;
      softShadows: boolean;
      terrainScreenSpaceError: number;
      resolutionScale: number;
      shadows: boolean;
      msaaSamples: 1 | 2 | 4;
    }) => void
  >(() => {});
  const [resolving, setResolving] = useState(false);
  const [quality, setQuality] = useState<{
    shadowMapSize: 1024 | 2048 | 4096;
    softShadows: boolean;
    terrainScreenSpaceError: number;
    resolutionScale: number;
    shadows: boolean;
    msaaSamples: 1 | 2 | 4;
  } | null>(null);
  setQualityFromGovernor.current = setQuality;

  const moveTo = useCallback(
    async (p: GeoPoint & { viaTerrain: boolean }) => {
      setResolving(true);
      const provisional = {
        point: {
          latitude: p.latitude,
          longitude: p.longitude,
          ...(p.elevationM !== undefined ? { elevationM: p.elevationM } : {}),
        },
        timeZone: provisionalTimeZone(p, usePlannerStore.getState().location),
        label: `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`,
        source: 'map-click' as const,
      };
      setLocation(provisional, { keepCamera: true });
      try {
        const r = await api.get<ReverseResponse>(
          `/api/location/reverse?lat=${p.latitude.toFixed(5)}&lng=${p.longitude.toFixed(5)}`,
        );
        // A later click or step has moved on: this answer is for a place no longer chosen.
        if (!samePoint(usePlannerStore.getState().location?.point, provisional.point)) return;
        setLocation(
          {
            point: {
              ...provisional.point,
              ...(r.elevationM !== null ? { elevationM: r.elevationM } : {}),
            },
            timeZone: r.timeZone,
            label: r.place?.label ?? provisional.label,
            source: 'map-click',
          },
          { keepCamera: true },
        );
      } catch {
        /* keep the provisional pin: coordinates always work (plan §34) */
      } finally {
        setResolving(false);
      }
    },
    [setLocation],
  );
  // The globe's own click. While looking from a viewpoint, clicks are the pointer handlers' below
  // (a drag looks, a click walks), so the globe's click is ignored there.
  const onPick = useCallback(
    (p: GeoPoint & { viaTerrain: boolean }) => {
      const s = usePlannerStore.getState();
      if (s.camera.mode === 'viewpoint' && s.location) return;
      void moveTo(p);
    },
    [moveTo],
  );

  const renderer = useRenderer({
    container,
    credits,
    capabilities,
    onPick,
    onQualityChange: (q) => setQualityFromGovernor.current(q),
    enabled: true,
    ionToken: capabilities?.ionToken,
  });

  // Apply the scene with the governor's quality merged in.
  const effectiveScene =
    scene && quality
      ? {
          ...scene,
          render: { ...scene.render, ...quality, shadows: scene.render.shadows && quality.shadows },
        }
      : scene;
  useApplyScene(renderer.controller, effectiveScene);

  const host = renderer.host;
  // Stable per host, so consumers keyed on it (the terrain-horizon run) do not restart when the
  // quality label or error text changes.
  const sampleHeights = useMemo(
    () =>
      host
        ? (points: readonly GeoPoint[], level: number) => host.sampleGroundHeights(points, level)
        : null,
    [host],
  );
  const sampleSurface = useMemo(
    () => (host ? (points: readonly GeoPoint[]) => host.sampleSurfaceHeights(points) : null),
    [host],
  );
  useEffect(() => {
    onRendererInfo?.({
      mode: renderer.mode,
      qualityLabel: renderer.qualityLabel,
      getStats: () => (host ? host.stats() : null),
      error: renderer.error,
      capabilities: renderer.capabilities,
      capture: (maxWidth = 320) => (host ? host.captureThumbnail(maxWidth) : Promise.resolve(null)),
      sampleHeights,
      sampleSurface,
    });
  }, [
    renderer.mode,
    renderer.qualityLabel,
    renderer.error,
    renderer.capabilities,
    host,
    sampleHeights,
    sampleSurface,
    onRendererInfo,
  ]);

  // Drag-to-look in viewpoint mode; a click (no drag) while the finder is picking sets its target.
  const drag = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
    id: number;
    moved: boolean;
    /** Pixels the pointer may wander before a press stops being a tap (fingers wobble more). */
    slop: number;
  } | null>(null);
  // Looking from a viewpoint needs a place to stand; before one is picked the globe takes clicks.
  const looking = camera.mode === 'viewpoint' && location !== null;
  // A one-line hint on how to move, until the first walk (remembered on this device).
  const [walkHint, setWalkHint] = useState(() => {
    try {
      return localStorage.getItem('lightmap:walk-hint-seen') !== '1';
    } catch {
      return true;
    }
  });
  const walked = () => {
    if (!walkHint) return;
    setWalkHint(false);
    try {
      localStorage.setItem('lightmap:walk-hint-seen', '1');
    } catch {
      // the hint shows again next time
    }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!looking) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      ox: e.clientX,
      oy: e.clientY,
      id: e.pointerId,
      moved: false,
      slop: e.pointerType === 'touch' ? 10 : 3,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const pickInFrame = (e: React.PointerEvent) => {
    const el = container.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    setFinderTarget(directionFromFrame(camera, x, y, rect.width / rect.height));
  };
  const pendingLook = useRef({ yaw: 0, pitch: 0 });
  const lookFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (lookFrame.current !== null) cancelAnimationFrame(lookFrame.current);
    },
    [],
  );
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    // "Moved" is measured from the pointer-down origin, so a slow trackpad/touch drag (1–2 px per
    // event) still counts as a drag, never as a click.
    drag.current = {
      ...drag.current,
      x: e.clientX,
      y: e.clientY,
      moved:
        drag.current.moved ||
        Math.hypot(e.clientX - drag.current.ox, e.clientY - drag.current.oy) > drag.current.slop,
    };
    const degPerPx = camera.fovDeg / Math.max(320, container.current?.clientWidth ?? 800);
    // Gathered and applied once a frame: a fast mouse or a 120 Hz trackpad sends several moves a
    // frame, each a store update, a scene rebuild and a re-render for a view drawn only once.
    pendingLook.current.yaw += dx * degPerPx;
    pendingLook.current.pitch += -dy * degPerPx;
    lookFrame.current ??= requestAnimationFrame(() => {
      lookFrame.current = null;
      const { yaw, pitch } = pendingLook.current;
      pendingLook.current = { yaw: 0, pitch: 0 };
      if (yaw !== 0 || pitch !== 0) rotateCamera(yaw, pitch);
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    const wasClick = !drag.current.moved;
    drag.current = null;
    if (!wasClick || !looking) return;
    if (finderPicking) {
      pickInFrame(e);
      return;
    }
    // A click on the ground walks there: the eye moves, the heading stays.
    const el = container.current;
    if (!el || !host?.pickAt) return;
    const rect = el.getBoundingClientRect();
    const hit = host.pickAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      walked();
      void moveTo(hit);
    }
  };
  const onPointerCancel = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null; // a cancelled gesture never picks
  };
  // The wheel sets where the zoom is going (by how far it scrolled, `wheelZoomFactor`); the lens
  // eases there a frame at a time (`easeFovToward`), so a mouse notch opens smoothly and a
  // trackpad's stream of deltas costs one store update a frame. A lens set elsewhere meanwhile
  // (a focal-length button) wins, and "reduce motion" lands at once.
  const zoomGoal = useRef<number | null>(null);
  const zoomShown = useRef<number | null>(null);
  const zoomFrame = useRef<number | null>(null);
  const stopZoom = () => {
    if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
    zoomFrame.current = null;
    zoomGoal.current = null;
    zoomShown.current = null;
  };
  const zoomLoop = (last: number) => (t: number) => {
    zoomFrame.current = null;
    const goal = zoomGoal.current;
    const st = usePlannerStore.getState();
    if (goal === null || st.camera.mode !== 'viewpoint' || st.camera.fovDeg !== zoomShown.current) {
      stopZoom();
      return;
    }
    const step = easeFovToward(st.camera.fovDeg, goal, Math.min(50, Math.max(0, t - last)));
    st.setFov(step.fovDeg);
    zoomShown.current = usePlannerStore.getState().camera.fovDeg;
    if (step.done) stopZoom();
    else zoomFrame.current = requestAnimationFrame(zoomLoop(t));
  };
  useEffect(
    () => () => {
      if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
    },
    [],
  );
  const onWheel = (e: React.WheelEvent) => {
    if (!looking) return;
    const store = usePlannerStore.getState();
    const fov = store.camera.fovDeg;
    // A lens changed since the last frame of the zoom: start over from it.
    if (zoomShown.current !== fov) stopZoom();
    const goal = wheelZoomGoal(fov, zoomGoal.current, e);
    if (store.reducedMotion) {
      store.setFov(goal);
      return;
    }
    zoomGoal.current = goal;
    zoomShown.current = fov;
    // A frame earlier: the first frame's timestamp can precede this event's.
    zoomFrame.current ??= requestAnimationFrame(zoomLoop(performance.now() - 16));
  };
  // W A S D walk from the viewpoint while held (`walkStep`: 6 m/s, 30 with Shift), in steps
  // of a tenth of a second that the renderer glides between, so the walk does not wait for the
  // keyboard's repeat delay or hop at its rate; the place (name, zone, height) is looked up when
  // the steps stop.
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(new Set<string>());
  const walkLoop = useRef<ReturnType<typeof setInterval> | null>(null);
  const shiftHeld = useRef(false);
  const stopWalking = () => {
    held.current.clear();
    if (walkLoop.current) clearInterval(walkLoop.current);
    walkLoop.current = null;
  };
  useEffect(
    () => () => {
      if (walkTimer.current) clearTimeout(walkTimer.current);
      if (walkLoop.current) clearInterval(walkLoop.current);
    },
    [],
  );
  // A key-up can go missing (the window loses focus, a context menu takes it, macOS drops the
  // letter's key-up under Cmd): stop then, and whenever the view stops being the viewpoint.
  useEffect(() => {
    if (!looking) {
      stopWalking();
      stopTurning();
    }
    const stop = () => {
      stopWalking();
      stopTurning();
    };
    const hidden = () => {
      if (document.visibilityState !== 'visible') stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [looking]);
  const walk = (forwardM: number, rightM: number) => {
    const s = usePlannerStore.getState();
    const loc = s.location;
    if (!loc) return;
    let p: GeoPoint = loc.point;
    if (forwardM !== 0) p = destinationPoint(p, s.camera.headingDeg, forwardM);
    if (rightM !== 0) p = destinationPoint(p, s.camera.headingDeg + 90, rightM);
    const point = { latitude: p.latitude, longitude: p.longitude };
    setLocation(
      {
        ...loc,
        point,
        label: `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`,
        source: 'map-click',
      },
      { keepCamera: true },
    );
    if (walkTimer.current) clearTimeout(walkTimer.current);
    walkTimer.current = setTimeout(() => void moveTo({ ...point, viaTerrain: true }), 600);
  };
  const walkTick = () => {
    const step = walkStep(held.current, shiftHeld.current);
    if (step) walk(step.forwardM, step.rightM);
  };
  // Keys by their physical place (e.code), so Shift, Option or a keyboard layout does not change
  // which key-up ends the walk.
  // Arrow keys: a press turns one step (3°, 15° with Shift), as before; held, the view then
  // turns smoothly at TURN_DEG_PER_S a frame at a time instead of jumping at the keyboard's
  // repeat rate.
  const turning = useRef(new Set<string>());
  const turnFrame = useRef<number | null>(null);
  const turnHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTurning = () => {
    turning.current.clear();
    if (turnFrame.current !== null) cancelAnimationFrame(turnFrame.current);
    turnFrame.current = null;
    if (turnHoldTimer.current) clearTimeout(turnHoldTimer.current);
    turnHoldTimer.current = null;
  };
  const turnLoop = (last: number) => (t: number) => {
    const keys = turning.current;
    if (keys.size === 0) return;
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
    const rate = (shiftHeld.current ? 3 : 1) * TURN_DEG_PER_S * dt;
    const yaw = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    const pitch = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
    if (yaw !== 0 || pitch !== 0) rotateCamera(yaw * rate, pitch * rate * 0.6);
    turnFrame.current = requestAnimationFrame(turnLoop(t));
  };
  useEffect(
    () => () => {
      if (turnFrame.current !== null) cancelAnimationFrame(turnFrame.current);
      if (turnHoldTimer.current) clearTimeout(turnHoldTimer.current);
    },
    [],
  );
  const onKeyUp = (e: React.KeyboardEvent) => {
    shiftHeld.current = e.shiftKey;
    held.current.delete(e.code);
    if (held.current.size === 0) stopWalking();
    turning.current.delete(e.key);
    if (turning.current.size === 0) stopTurning();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!looking) return;
    shiftHeld.current = e.shiftKey;
    // A shortcut (Cmd/Ctrl with a letter) is not a step, and its letter's key-up may never come.
    if (e.metaKey || e.ctrlKey) {
      stopWalking();
      stopTurning();
      return;
    }
    const k = e.code;
    if (k === 'KeyW' || k === 'KeyS' || k === 'KeyA' || k === 'KeyD') {
      e.preventDefault();
      // The keyboard's own repeats are ignored: the loop walks while the key is down.
      if (e.repeat || held.current.has(k)) return;
      walked();
      held.current.add(k);
      // The first step at once (a tap still moves); the loop takes over from there.
      if (!walkLoop.current) {
        walkTick();
        walkLoop.current = setInterval(walkTick, WALK_TICK_MS);
      }
      return;
    }
    const step = e.shiftKey ? 15 : 3;
    const arrow =
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown';
    if (!arrow) return;
    e.preventDefault();
    if (turning.current.has(e.key)) return;
    const startTurning = () => {
      if (turnFrame.current === null)
        turnFrame.current = requestAnimationFrame(turnLoop(performance.now()));
    };
    if (e.repeat) {
      // A key still held after the turn was stopped (a blur, a shortcut): pick the turn up again.
      turning.current.add(e.key);
      startTurning();
      return;
    }
    // A second arrow during a smooth turn joins it; on its own a press turns one step.
    if (turnFrame.current === null) {
      if (e.key === 'ArrowLeft') rotateCamera(-step, 0);
      else if (e.key === 'ArrowRight') rotateCamera(step, 0);
      else if (e.key === 'ArrowUp') rotateCamera(0, step);
      else rotateCamera(0, -step);
    }
    turning.current.add(e.key);
    // Held past a moment: the smooth turn takes over.
    if (turnHoldTimer.current === null && turnFrame.current === null)
      turnHoldTimer.current = setTimeout(() => {
        turnHoldTimer.current = null;
        if (turning.current.size > 0)
          turnFrame.current = requestAnimationFrame(turnLoop(performance.now()));
      }, TURN_HOLD_MS);
  };

  const overlayMode = renderer.mode === 'OVERLAY';
  return (
    <div
      className={cx(
        'relative h-full w-full select-none overflow-clip bg-[var(--lm-chrome)]',
        className,
      )}
      data-testid="world-map"
      data-renderer-mode={renderer.mode}
    >
      {scene && overlayMode ? <SkyBackdrop scene={scene} /> : null}
      <div
        ref={container}
        className={cx(
          'absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--lm-sun)]',
          looking ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-crosshair',
          overlayMode && 'hidden',
        )}
        // `application` only where we really handle keys (viewpoint look-around); in map mode
        // screen readers keep their browse keys and are told to use search instead.
        role={looking ? 'application' : 'img'}
        aria-label={
          looking
            ? 'Viewpoint. Drag or use arrow keys to look around (Shift for larger steps); click the ground to walk there, or hold W A S D to walk (Shift to run).'
            : 'World map. Click or tap to place the pin, or use the search box.'
        }
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => {
          stopWalking();
          stopTurning();
        }}
        onContextMenu={() => {
          stopWalking();
          stopTurning();
        }}
      />
      {overlayMode && !location ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <EmptyState
            title="Search a place or paste coordinates"
            body={
              renderer.error ??
              'The 3D preview is unavailable here; light direction and sky still work.'
            }
          />
        </div>
      ) : null}
      {scene ? <SunDirectionOverlay scene={scene} compact={!overlayMode} /> : null}
      {finderPicking && camera.mode === 'viewpoint' ? (
        <p
          role="status"
          className="pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-[var(--lm-text)] lg:top-20"
          data-testid="finder-pick-hint"
        >
          Click where the sun (or moon) should be in this view.
        </p>
      ) : null}
      {looking && walkHint && !finderPicking && !overlayMode ? (
        <p
          className="pointer-events-none absolute bottom-24 left-1/2 z-10 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-black/65 px-3 py-1.5 text-center text-xs text-[var(--lm-text)] lg:bottom-8"
          data-testid="walk-hint"
        >
          Drag to look · click the ground to walk there · hold W A S D to walk
        </p>
      ) : null}
      {showLevelGuide && camera.mode === 'viewpoint' && !overlayMode && location ? (
        <LevelGuide />
      ) : null}
      {finderTarget && camera.mode === 'viewpoint' && !overlayMode ? (
        <FinderReticle
          target={finderTarget}
          camera={camera}
          container={container}
          onChange={setFinderTarget}
        />
      ) : null}
      {renderer.mode === 'loading' ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--lm-chrome)]/60">
          <span className="rounded-full bg-black/60 px-3 py-1.5 text-xs text-[var(--lm-text-muted)]">
            Loading globe…
          </span>
        </div>
      ) : null}
      {resolving ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-[var(--lm-text-muted)]"
        >
          Resolving place…
        </span>
      ) : null}
      {/* One permanent status region: mounts once, so every change is announced (plan §28). */}
      <span className="sr-only" role="status" data-testid="map-status">
        {renderer.mode === 'loading'
          ? 'Loading globe…'
          : resolving
            ? 'Resolving place…'
            : location
              ? `Pin at ${location.label}.`
              : ''}
      </span>
      <div
        ref={credits}
        className="pointer-events-none absolute bottom-1 right-1 text-[10px] text-white/50"
        aria-hidden
      />
    </div>
  );
}

/**
 * Marks the picked "sun here" direction in the viewpoint frame; re-projects as the camera moves and
 * can be dragged to refine the target (plan §26 "drags the desired sun marker onto the composition").
 * Keyboard: arrow keys nudge by 0.5° (Shift: 5°).
 */
function FinderReticle({
  target,
  camera,
  container,
  onChange,
}: {
  target: { azimuthDeg: number; elevationDeg: number };
  camera: { headingDeg: number; pitchDeg: number; fovDeg: number };
  container: React.RefObject<HTMLDivElement | null>;
  onChange: (t: { azimuthDeg: number; elevationDeg: number }) => void;
}) {
  const el = container.current;
  const aspect = el && el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 16 / 9;
  const f = frameCoordinates(camera, target.azimuthDeg, target.elevationDeg, aspect);
  const dragging = useRef<number | null>(null);
  if (!f || Math.abs(f.x) > 1.001 || Math.abs(f.y) > 1.001) return null;
  const fromEvent = (e: React.PointerEvent) => {
    const host = container.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    // Stay just inside the frame so the round trip through frameCoordinates cannot unmount the
    // ring (and drop pointer capture) mid-drag.
    const x = Math.max(-0.995, Math.min(0.995, ((e.clientX - rect.left) / rect.width) * 2 - 1));
    const y = Math.max(-0.995, Math.min(0.995, 1 - ((e.clientY - rect.top) / rect.height) * 2));
    return directionFromFrame(camera, x, y, rect.width / rect.height);
  };
  return (
    <button
      type="button"
      className="absolute z-10 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full border-2 border-[var(--lm-sun)] bg-transparent shadow-[0_0_0_2px_rgba(0,0,0,0.5)] focus-visible:outline-none focus-visible:[box-shadow:var(--lm-focus)] active:cursor-grabbing"
      style={{ left: `${((f.x + 1) / 2) * 100}%`, top: `${((1 - f.y) / 2) * 100}%` }}
      aria-label={`Light-finder target: bearing ${Math.round(target.azimuthDeg)}°, ${target.elevationDeg.toFixed(1)}° up. Drag or use arrow keys to move it.`}
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (dragging.current !== e.pointerId) return;
        const d = fromEvent(e);
        if (d) onChange(d);
      }}
      onPointerUp={(e) => {
        if (dragging.current === e.pointerId) dragging.current = null;
      }}
      onPointerCancel={() => {
        dragging.current = null;
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 5 : 0.5;
        let az = target.azimuthDeg;
        let elv = target.elevationDeg;
        if (e.key === 'ArrowLeft') az -= step;
        else if (e.key === 'ArrowRight') az += step;
        else if (e.key === 'ArrowUp') elv += step;
        else if (e.key === 'ArrowDown') elv -= step;
        else return;
        e.preventDefault();
        e.stopPropagation();
        onChange({
          azimuthDeg: ((az % 360) + 360) % 360,
          elevationDeg: Math.max(-89, Math.min(89, elv)),
        });
      }}
      data-testid="finder-reticle"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--lm-sun)]" />
    </button>
  );
}

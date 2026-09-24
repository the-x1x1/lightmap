'use client';
/**
 * WorldMap: the Cesium globe (Quality 1+) with the Quality-0 overlay always available on top.
 * Click/tap sets the pin; in viewpoint mode drag rotates the camera (heading/pitch).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { directionFromFrame, frameCoordinates } from '@lightmap/scene';
import { usePlannerStore } from '@/features/planner/store';
import { useApplyScene, useRenderer } from '@/features/map/use-renderer';
import { api } from '@/lib/client/api';
import type { CapabilitiesResponse, ReverseResponse } from '@/lib/api-types';
import type { SceneState } from '@lightmap/scene';
import type { GeoPoint } from '@lightmap/geospatial';
import type { HostStats, RendererCapabilities } from '@lightmap/renderer';
import { SunDirectionOverlay } from './SunDirectionOverlay';
import { SkyBackdrop } from './SkyBackdrop';
import { EmptyState } from './states/EmptyState';
import { cx } from '@lightmap/ui';

export interface RendererInfo {
  mode: '3D' | 'OVERLAY' | 'loading';
  qualityLabel: string;
  /** Polled, not pushed: call when a panel wants numbers. */
  getStats: () => HostStats | null;
  error: string | null;
  capabilities: RendererCapabilities | null;
  /** JPEG data URL of the current frame, downscaled to `maxWidth` (default 320 for thumbnails). */
  capture: (maxWidth?: number) => Promise<string | null>;
}

export interface WorldMapProps {
  scene: SceneState | null;
  capabilities: CapabilitiesResponse | null;
  onRendererInfo?: (info: RendererInfo) => void;
  className?: string;
}

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
  const setQualityFromGovernor = useRef<
    (q: {
      shadowMapSize: 1024 | 2048 | 4096;
      softShadows: boolean;
      terrainScreenSpaceError: number;
      resolutionScale: number;
      shadows: boolean;
    }) => void
  >(() => {});
  const [resolving, setResolving] = useState(false);
  const [quality, setQuality] = useState<{
    shadowMapSize: 1024 | 2048 | 4096;
    softShadows: boolean;
    terrainScreenSpaceError: number;
    resolutionScale: number;
    shadows: boolean;
  } | null>(null);
  setQualityFromGovernor.current = setQuality;

  const onPick = useCallback(
    async (p: GeoPoint & { viaTerrain: boolean }) => {
      if (usePlannerStore.getState().camera.mode === 'viewpoint') return; // dragging to look, not picking
      setResolving(true);
      const provisional = {
        point: {
          latitude: p.latitude,
          longitude: p.longitude,
          ...(p.elevationM !== undefined ? { elevationM: p.elevationM } : {}),
        },
        timeZone:
          usePlannerStore.getState().location?.timeZone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        label: `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`,
        source: 'map-click' as const,
      };
      setLocation(provisional, { keepCamera: true });
      try {
        const r = await api.get<ReverseResponse>(
          `/api/location/reverse?lat=${p.latitude.toFixed(5)}&lng=${p.longitude.toFixed(5)}`,
        );
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
  useEffect(() => {
    onRendererInfo?.({
      mode: renderer.mode,
      qualityLabel: renderer.qualityLabel,
      getStats: () => (host ? host.stats() : null),
      error: renderer.error,
      capabilities: renderer.capabilities,
      capture: (maxWidth = 320) => (host ? host.captureThumbnail(maxWidth) : Promise.resolve(null)),
    });
  }, [
    renderer.mode,
    renderer.qualityLabel,
    renderer.error,
    renderer.capabilities,
    host,
    onRendererInfo,
  ]);

  // Drag-to-look in viewpoint mode; a click (no drag) while the finder is picking sets its target.
  const drag = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (camera.mode !== 'viewpoint') return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
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
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = {
      ...drag.current,
      x: e.clientX,
      y: e.clientY,
      moved: drag.current.moved || Math.abs(dx) + Math.abs(dy) > 3,
    };
    const degPerPx = camera.fovDeg / Math.max(320, container.current?.clientWidth ?? 800);
    rotateCamera(dx * degPerPx, -dy * degPerPx);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    const wasClick = !drag.current.moved;
    drag.current = null;
    if (wasClick && finderPicking && camera.mode === 'viewpoint') pickInFrame(e);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (camera.mode !== 'viewpoint') return;
    const store = usePlannerStore.getState();
    store.setFov(store.camera.fovDeg * (e.deltaY > 0 ? 1.08 : 0.92));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (camera.mode !== 'viewpoint') return;
    const step = e.shiftKey ? 15 : 3;
    if (e.key === 'ArrowLeft') rotateCamera(-step, 0);
    else if (e.key === 'ArrowRight') rotateCamera(step, 0);
    else if (e.key === 'ArrowUp') rotateCamera(0, step);
    else if (e.key === 'ArrowDown') rotateCamera(0, -step);
    else return;
    e.preventDefault();
  };

  const overlayMode = renderer.mode === 'OVERLAY';
  return (
    <div
      className={cx(
        'relative h-full w-full select-none overflow-hidden bg-[var(--lm-chrome)]',
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
          camera.mode === 'viewpoint'
            ? 'cursor-grab active:cursor-grabbing touch-none'
            : 'cursor-crosshair',
          overlayMode && 'hidden',
        )}
        // `application` only where we really handle keys (viewpoint look-around); in map mode
        // screen readers keep their browse keys and are told to use search instead.
        role={camera.mode === 'viewpoint' ? 'application' : 'img'}
        aria-label={
          camera.mode === 'viewpoint'
            ? 'Viewpoint. Drag or use arrow keys to look around; Shift for larger steps.'
            : 'World map. Click or tap to place the pin, or use the search box.'
        }
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
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
  if (!f || Math.abs(f.x) > 1 || Math.abs(f.y) > 1) return null;
  const fromEvent = (e: React.PointerEvent) => {
    const host = container.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const x = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, 1 - ((e.clientY - rect.top) / rect.height) * 2));
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

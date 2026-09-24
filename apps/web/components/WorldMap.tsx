'use client';
/**
 * WorldMap: the Cesium globe (Quality 1+) with the Quality-0 overlay always available on top.
 * Click/tap sets the pin; in viewpoint mode drag rotates the camera (heading/pitch).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
  stats: HostStats | null;
  error: string | null;
  capabilities: RendererCapabilities | null;
  capture: () => Promise<string | null>;
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
      stats: renderer.stats,
      error: renderer.error,
      capabilities: renderer.capabilities,
      capture: () => (host ? host.captureThumbnail(320) : Promise.resolve(null)),
    });
  }, [
    renderer.mode,
    renderer.qualityLabel,
    renderer.stats,
    renderer.error,
    renderer.capabilities,
    host,
    onRendererInfo,
  ]);

  // Drag-to-look in viewpoint mode.
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (camera.mode !== 'viewpoint') return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { ...drag.current, x: e.clientX, y: e.clientY };
    const degPerPx = camera.fovDeg / Math.max(320, container.current?.clientWidth ?? 800);
    rotateCamera(dx * degPerPx, -dy * degPerPx);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
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
          'absolute inset-0',
          camera.mode === 'viewpoint'
            ? 'cursor-grab active:cursor-grabbing touch-none'
            : 'cursor-crosshair',
          overlayMode && 'hidden',
        )}
        role="application"
        aria-label={
          camera.mode === 'viewpoint'
            ? 'Viewpoint. Drag or use arrow keys to look around.'
            : 'World map. Click or tap to place the pin.'
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
      {renderer.mode === 'loading' ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--lm-chrome)]/60"
          aria-live="polite"
        >
          <span className="rounded-full bg-black/60 px-3 py-1.5 text-xs text-[var(--lm-text-muted)]">
            Loading globe…
          </span>
        </div>
      ) : null}
      {resolving ? (
        <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-[var(--lm-text-muted)]">
          Resolving place…
        </span>
      ) : null}
      <div
        ref={credits}
        className="pointer-events-none absolute bottom-1 right-1 text-[10px] text-white/50"
        aria-hidden
      />
    </div>
  );
}

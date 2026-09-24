'use client';
/**
 * Owns the Cesium host + SceneController lifecycle for the map element. Loads @cesium/engine only
 * when the component mounts (plan §27: lazy-load heavy renderer modules) and only when WebGL2 is
 * available; otherwise reports 'OVERLAY' so the page renders the Quality-0 view instead.
 */
import { useEffect, useRef, useState } from 'react';
import { QUALITY_LADDER, QualityGovernor, SceneController, detectCapabilities, qualityCeiling, resolveRenderMode, type HostStats, type RendererCapabilities, type SceneHost } from '@lightmap/renderer';
import type { SceneState } from '@lightmap/scene';
import type { GeoPoint } from '@lightmap/geospatial';
import type { CapabilitiesResponse } from '@/lib/api-types';

export interface RendererHandle {
  mode: '3D' | 'OVERLAY' | 'loading';
  error: string | null;
  capabilities: RendererCapabilities | null;
  qualityLabel: string;
  stats: HostStats | null;
  controller: SceneController | null;
  host: SceneHost | null;
}

export interface UseRendererOptions {
  container: React.RefObject<HTMLDivElement | null>;
  credits: React.RefObject<HTMLDivElement | null>;
  capabilities: CapabilitiesResponse | null;
  onPick: (p: GeoPoint & { viaTerrain: boolean }) => void;
  onQualityChange: (q: { shadowMapSize: 1024 | 2048 | 4096; softShadows: boolean; terrainScreenSpaceError: number; resolutionScale: number; shadows: boolean }) => void;
  enabled: boolean;
}

export function useRenderer(opts: UseRendererOptions): RendererHandle {
  const [state, setState] = useState<RendererHandle>({ mode: 'loading', error: null, capabilities: null, qualityLabel: '—', stats: null, controller: null, host: null });
  const controllerRef = useRef<SceneController | null>(null);
  const onPickRef = useRef(opts.onPick);
  onPickRef.current = opts.onPick;
  const onQualityRef = useRef(opts.onQualityChange);
  onQualityRef.current = opts.onQualityChange;

  useEffect(() => {
    if (!opts.enabled || !opts.container.current || !opts.credits.current) return;
    const caps = detectCapabilities();
    const mode = resolveRenderMode(caps);
    if (mode === 'OVERLAY') {
      setState((s) => ({ ...s, mode: 'OVERLAY', capabilities: caps, error: 'This browser has no WebGL2, so the 3D preview is unavailable. The map overlay still shows sun direction and light.' }));
      return;
    }
    let cancelled = false;
    let disposers: Array<() => void> = [];
    (async () => {
      try {
        (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium';
        const { createCesiumHost } = await import('@lightmap/renderer/cesium');
        if (cancelled || !opts.container.current || !opts.credits.current) return;
        const host = await createCesiumHost({
          container: opts.container.current,
          creditContainer: opts.credits.current,
          requestRenderMode: true,
          onError: (message, error) => {
            console.warn('[renderer]', message, error);
            setState((s) => ({ ...s, error: message }));
          },
        });
        if (cancelled) {
          host.destroy();
          return;
        }
        const controller = new SceneController(host, { aspect: () => (opts.container.current ? opts.container.current.clientWidth / Math.max(1, opts.container.current.clientHeight) : 16 / 9) });
        controllerRef.current = controller;
        const governor = new QualityGovernor({ ceilingRung: qualityCeiling(caps, QUALITY_LADDER) });
        const emitQuality = () => {
          const q = governor.quality;
          onQualityRef.current({ shadowMapSize: q.shadowMapSize, softShadows: q.softShadows, terrainScreenSpaceError: q.terrainScreenSpaceError, resolutionScale: q.resolutionScale, shadows: q.shadows });
          setState((s) => ({ ...s, qualityLabel: q.label }));
        };
        emitQuality();
        disposers.push(host.onPick((p) => onPickRef.current(p)));
        disposers.push(host.onFrameSample((fps) => {
          if (governor.sample({ fps })) emitQuality();
          setState((s) => ({ ...s, stats: host.stats() }));
        }));
        const ro = new ResizeObserver(() => host.resize());
        ro.observe(opts.container.current);
        disposers.push(() => ro.disconnect());
        setState({ mode: '3D', error: null, capabilities: caps, qualityLabel: governor.quality.label, stats: host.stats(), controller, host });
      } catch (error) {
        console.error('[renderer] failed to start', error);
        setState((s) => ({ ...s, mode: 'OVERLAY', capabilities: caps, error: 'The 3D preview could not start on this device. Showing the map overlay instead.' }));
      }
    })();
    return () => {
      cancelled = true;
      for (const d of disposers) d();
      disposers = [];
      controllerRef.current?.destroy();
      controllerRef.current = null;
      setState((s) => ({ ...s, controller: null, host: null }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  // Providers from capabilities.
  useEffect(() => {
    const c = state.controller;
    const caps = opts.capabilities;
    if (!c || !caps) return;
    void c.setProviders(caps.providers.terrain, caps.providers.basemap);
  }, [state.controller, opts.capabilities]);

  return state;
}

/** Push each SceneState into the controller. Separate hook so the map shell stays declarative. */
export function useApplyScene(controller: SceneController | null, scene: SceneState | null): void {
  useEffect(() => {
    if (controller && scene) controller.apply(scene);
  }, [controller, scene]);
}

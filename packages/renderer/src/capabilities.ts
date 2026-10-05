/**
 * Renderer capability detection: can this browser run the 3D globe, and how well?
 *
 * Provenance: ported from the owner's WorldView repository — `render-core/src/renderer-host.ts`
 * (`resolveRenderMode`), `apps/desktop/src/renderer/main.tsx` (`detectCapabilities`) and
 * `apps/desktop/src/renderer/map/gpu-info.ts` — owner-authored, MIT. Rewritten so the result
 * chooses between the 3D terrain preview (Quality 1) and the Quality-0 map overlay, and picks a
 * ceiling rung for the QualityGovernor. See docs/WORLDVIEW_REUSE_AUDIT.md row 5.
 */
import type { QualityRung } from './quality-governor.ts';

export interface RendererCapabilities {
  webgl2: boolean;
  /** `navigator.gpu` exists (plan §27 debug panel); the renderer itself is WebGL2 for now. */
  webgpu: boolean;
  /** Battery saver / integrated GPU heuristic. */
  lowPower: boolean;
  /** GPU renderer string as WebGL reports it, when exposed. */
  gpu: string | undefined;
  /** Max texture size — a proxy for how large a shadow map is affordable. */
  maxTextureSize: number | undefined;
  /** Whether the page asked for reduced motion. */
  reducedMotion: boolean;
  /** Coarse pointer (touch) — bigger hit targets, orbit inertia off. */
  touch: boolean;
  devicePixelRatio: number;
}

export interface CapabilityProbeEnvironment {
  createCanvas?: () => {
    getContext(kind: 'webgl2' | 'webgl'): WebGLRenderingContext | WebGL2RenderingContext | null;
  } | null;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  matchMedia?: (q: string) => { matches: boolean } | null;
  devicePixelRatio?: number;
  /** Whether a WebGPU adapter entry point exists. */
  hasWebGpu?: boolean;
}

/** Probe once with a throwaway canvas; the context is released afterwards. */
export function detectCapabilities(
  env: CapabilityProbeEnvironment = defaultEnvironment(),
): RendererCapabilities {
  let webgl2 = false;
  let gpu: string | undefined;
  let maxTextureSize: number | undefined;
  try {
    const canvas = env.createCanvas?.();
    const gl = (canvas?.getContext('webgl2') ?? null) as WebGL2RenderingContext | null;
    if (gl) {
      webgl2 = true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info') as {
        UNMASKED_RENDERER_WEBGL: number;
      } | null;
      const value = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as unknown;
      if (typeof value === 'string' && value.trim()) gpu = value.trim().slice(0, 256);
      const mts = gl.getParameter(gl.MAX_TEXTURE_SIZE) as unknown;
      if (typeof mts === 'number' && Number.isFinite(mts)) maxTextureSize = mts;
      (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    }
  } catch {
    webgl2 = false;
  }
  const cores = env.hardwareConcurrency;
  const mem = env.deviceMemoryGb;
  const lowPower =
    (typeof cores === 'number' && cores <= 4) ||
    (typeof mem === 'number' && mem <= 4) ||
    /Mali-4|Adreno \(TM\) [3-5]|PowerVR|SwiftShader|llvmpipe/i.test(gpu ?? '');
  const reducedMotion = env.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const touch = env.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  return {
    webgl2,
    webgpu: env.hasWebGpu ?? false,
    lowPower,
    gpu,
    maxTextureSize,
    reducedMotion,
    touch,
    devicePixelRatio: env.devicePixelRatio ?? 1,
  };
}

export type RenderMode = '3D' | 'OVERLAY';

/** The globe needs WebGL2; everything else degrades within the globe via the quality ladder. */
export function resolveRenderMode(
  caps: RendererCapabilities,
  requested: RenderMode | 'AUTO' = 'AUTO',
): RenderMode {
  if (requested !== 'AUTO') return requested === '3D' && !caps.webgl2 ? 'OVERLAY' : requested;
  return caps.webgl2 ? '3D' : 'OVERLAY';
}

/** Highest rung the governor may climb to on this device. */
export function qualityCeiling(caps: RendererCapabilities, ladder: readonly QualityRung[]): number {
  if (caps.lowPower) return Math.min(ladder.length - 1, 2); // Balanced at best
  if ((caps.maxTextureSize ?? 8192) < 4096) return Math.min(ladder.length - 1, 1);
  return 0;
}

function defaultEnvironment(): CapabilityProbeEnvironment {
  if (typeof document === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  return {
    createCanvas: () => document.createElement('canvas'),
    hasWebGpu: nav.gpu !== undefined && nav.gpu !== null,
    hardwareConcurrency: nav.hardwareConcurrency,
    ...(typeof nav.deviceMemory === 'number' ? { deviceMemoryGb: nav.deviceMemory } : {}),
    matchMedia: (q) => (typeof window.matchMedia === 'function' ? window.matchMedia(q) : null),
    devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
  };
}

/**
 * Live device conditions (roadmap Phase 4 "better device performance adaptation"): unlike the
 * one-off capability probe these change while the app runs, so the governor's ceiling follows
 * them. Battery and Save-Data are honoured because a field session on a phone is the use case.
 */
export interface DeviceConditions {
  /** 0–1 when the Battery Status API is available. */
  batteryLevel?: number;
  charging?: boolean;
  /** `navigator.connection.saveData` or `prefers-reduced-data`. */
  saveData: boolean;
}

/**
 * The best rung the conditions allow (0 = no restriction). Shadows are never switched off by
 * conditions — whether a shadow exists is decided by the Sun, not by the battery — so the worst
 * answer here is the "Battery" rung, never "Minimal".
 */
export function conditionsCeiling(c: DeviceConditions, ladder: readonly QualityRung[]): number {
  const worst = Math.max(
    0,
    ladder.findLastIndex((r) => r.shadows),
  );
  const balanced = Math.min(worst, 2);
  let ceiling = 0;
  if (c.saveData) ceiling = Math.max(ceiling, balanced);
  if (c.charging === false && typeof c.batteryLevel === 'number') {
    if (c.batteryLevel <= 0.2) ceiling = Math.max(ceiling, worst);
    else if (c.batteryLevel <= 0.5) ceiling = Math.max(ceiling, balanced);
  }
  return ceiling;
}

/** Highest rung the governor may use right now: the device's static ceiling or the conditions', whichever is lower. */
export function effectiveCeiling(
  caps: RendererCapabilities,
  conditions: DeviceConditions,
  ladder: readonly QualityRung[],
): number {
  return Math.max(qualityCeiling(caps, ladder), conditionsCeiling(conditions, ladder));
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

/**
 * Watch the Battery Status API and Save-Data; calls `onChange` once immediately and again on
 * every change. Returns a disposer. Browsers without the APIs get one call with `saveData` only.
 */
export function watchDeviceConditions(
  onChange: (c: DeviceConditions) => void,
  env: {
    navigator?: Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
      connection?: EventTarget & { saveData?: boolean };
    };
    matchMedia?: (q: string) => { matches: boolean } | null;
  } = typeof navigator === 'undefined'
    ? {}
    : {
        navigator,
        matchMedia: (q) => (typeof window.matchMedia === 'function' ? window.matchMedia(q) : null),
      },
): () => void {
  let disposed = false;
  let battery: BatteryManagerLike | null = null;
  const connection = env.navigator?.connection;
  const current = (): DeviceConditions => ({
    saveData:
      connection?.saveData === true ||
      (env.matchMedia?.('(prefers-reduced-data: reduce)')?.matches ?? false),
    ...(battery ? { batteryLevel: battery.level, charging: battery.charging } : {}),
  });
  const emit = () => {
    if (!disposed) onChange(current());
  };
  emit();
  connection?.addEventListener?.('change', emit);
  env.navigator
    ?.getBattery?.()
    .then((b) => {
      if (disposed) return;
      battery = b;
      b.addEventListener('levelchange', emit);
      b.addEventListener('chargingchange', emit);
      emit();
    })
    .catch(() => {
      /* battery status unavailable */
    });
  return () => {
    disposed = true;
    connection?.removeEventListener?.('change', emit);
    battery?.removeEventListener('levelchange', emit);
    battery?.removeEventListener('chargingchange', emit);
  };
}

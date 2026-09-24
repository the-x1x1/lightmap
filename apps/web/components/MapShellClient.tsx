'use client';
import dynamic from 'next/dynamic';

/**
 * `ssr: false` is only permitted inside a Client Component in Next 15, and the map shell must never
 * render on the server (WebGL, window). This thin wrapper is the boundary.
 */
export const MapShellClient = dynamic(
  () => import('@/components/MapShell').then((m) => m.MapShell),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-dvh items-center justify-center bg-[var(--lm-chrome)] text-sm text-[var(--lm-text-muted)]"
        role="status"
        aria-busy
      >
        Loading LightMap…
      </div>
    ),
  },
);

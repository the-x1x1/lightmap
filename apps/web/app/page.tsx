import dynamic from 'next/dynamic';

// The map shell is client-only (WebGL, window). Loaded without SSR so the server never touches Cesium.
const MapShell = dynamic(() => import('@/components/MapShell').then((m) => m.MapShell), {
  ssr: false,
  loading: () => (
    <main
      className="flex h-dvh items-center justify-center bg-[var(--lm-chrome)] text-sm text-[var(--lm-text-muted)]"
      aria-busy
    >
      Loading LightMap…
    </main>
  ),
});

export default function HomePage() {
  return (
    <main className="h-dvh">
      <MapShell />
    </main>
  );
}

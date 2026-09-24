'use client';
/** Development-only performance panel (plan §27). Toggle with the ` key. */
import {
  angleBetweenDeg,
  azElFromEcefToward,
  enuToEcef,
  enuTowardSun,
  type HostStats,
} from '@lightmap/renderer';
import type { SceneState } from '@lightmap/scene';
import { useEffect, useState } from 'react';

export function PerfPanel({
  scene,
  getStats,
  qualityLabel,
  rendererMode,
  capabilities,
  weatherCached,
}: {
  scene: SceneState | null;
  getStats: () => HostStats | null;
  qualityLabel: string;
  rendererMode: string;
  capabilities: { webgl2: boolean; gpu: string | undefined } | null;
  weatherCached: boolean | null;
}) {
  const [stats, setStats] = useState<HostStats | null>(null);
  useEffect(() => {
    const id = setInterval(() => setStats(getStats()), 1000);
    return () => clearInterval(id);
  }, [getStats]);
  let sunCheck = '—';
  if (scene && stats?.cesiumSunDirectionEcef) {
    const ours = enuToEcef(
      enuTowardSun(scene.solar.azimuthDegrees, scene.solar.elevationDegrees),
      scene.location.point.latitude,
      scene.location.point.longitude,
    );
    const delta = angleBetweenDeg(ours, stats.cesiumSunDirectionEcef);
    const cz = azElFromEcefToward(
      stats.cesiumSunDirectionEcef,
      scene.location.point.latitude,
      scene.location.point.longitude,
    );
    sunCheck = `Δ ${delta.toFixed(2)}° (Cesium az ${cz.azimuthDeg.toFixed(1)} el ${cz.elevationDeg.toFixed(1)})`;
  }
  const rows: Array<[string, string]> = [
    ['Renderer', rendererMode],
    ['Quality', qualityLabel],
    ['FPS', stats ? stats.fps.toFixed(0) : '—'],
    [
      'Terrain tiles',
      stats ? `${stats.terrainTilesLoaded} shown · ${stats.terrainTilesLoading} loading` : '—',
    ],
    [
      'WebGL2 / GPU',
      capabilities
        ? `${capabilities.webgl2 ? 'yes' : 'no'} · ${capabilities.gpu ?? 'unknown'}`
        : '—',
    ],
    ['Weather cache', weatherCached === null ? '—' : weatherCached ? 'hit' : 'miss/fresh'],
    ['Sun vs Cesium ephemeris', sunCheck],
    ['Scene utc', scene ? scene.utc.toISOString() : '—'],
  ];
  return (
    <div
      className="pointer-events-none fixed bottom-2 left-2 z-50 rounded-md bg-black/80 p-2 font-mono text-[11px] text-white/90"
      data-testid="perf-panel"
    >
      {rows.map(([k, v]) => (
        <div key={k}>
          <span className="text-white/50">{k}: </span>
          {v}
        </div>
      ))}
    </div>
  );
}

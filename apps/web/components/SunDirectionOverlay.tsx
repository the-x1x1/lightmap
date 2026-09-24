'use client';
/**
 * Quality-0 overlay (plan §6): compass rose with sun arrow, shadow arrow and the day's sun path.
 * Always correct, always available, driven by SceneState only. In 3D mode it shrinks to a corner
 * compass; in overlay mode it is the hero.
 */
import { lightingFromScene } from '@lightmap/renderer';
import type { SceneState } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { sunPosition } from '@lightmap/astronomy';
import { useMemo } from 'react';

export function SunDirectionOverlay({ scene, compact }: { scene: SceneState; compact: boolean }) {
  const light = lightingFromScene(scene);
  const size = compact ? 132 : 300;
  const r = size / 2 - 14;
  const c = size / 2;
  const az = scene.solar.azimuthDegrees;
  const el = scene.solar.elevationDegrees;
  const up = el > -0.833;
  // Sun marker: radius shrinks toward the centre as the sun climbs (an "orthographic" sky dome).
  const sunR = r * Math.cos(Math.max(0, el) * (Math.PI / 180));
  const rad = (d: number) => ((d - 90) * Math.PI) / 180;
  const sx = c + sunR * Math.cos(rad(az));
  const sy = c + sunR * Math.sin(rad(az));
  const path = useMemo(() => {
    const pts: string[] = [];
    const start = scene.dayEvents.dayStart.getTime();
    const end = scene.dayEvents.dayEnd.getTime();
    for (let t = start; t <= end; t += 10 * 60_000) {
      const p = sunPosition(new Date(t), scene.location.point.latitude, scene.location.point.longitude);
      if (p.elevationDeg < 0) continue;
      const rr = r * Math.cos(p.elevationDeg * (Math.PI / 180));
      pts.push(`${(c + rr * Math.cos(rad(p.azimuthDeg))).toFixed(1)},${(c + rr * Math.sin(rad(p.azimuthDeg))).toFixed(1)}`);
    }
    return pts.length > 1 ? `M${pts.join(' L')}` : '';
  }, [scene.dayEvents.dayStart, scene.dayEvents.dayEnd, scene.location.point.latitude, scene.location.point.longitude, r, c]);
  const shadowAz = light.shadow.azimuthDeg;
  const shadowLen = light.shadow.lengthPerMetre === null ? 0 : Math.min(r * 0.9, r * 0.25 * Math.min(4, light.shadow.lengthPerMetre));
  const shx = c + shadowLen * Math.cos(rad(shadowAz));
  const shy = c + shadowLen * Math.sin(rad(shadowAz));
  const camHeading = scene.camera.headingDeg;

  const label = up ? `Sun at ${Math.round(el)}° elevation, bearing ${Math.round(az)}° (${compassLabel(az)}). Shadows fall toward ${compassLabel(shadowAz)}.` : `Sun ${Math.abs(Math.round(el))}° below the horizon (${scene.solar.phase.replace('-', ' ')}).`;

  return (
    <figure className={compact ? 'pointer-events-none absolute right-3 top-3 z-10' : 'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 p-6'} aria-label="Sun direction" data-testid="sun-direction-overlay" data-sun-azimuth={az.toFixed(1)} data-sun-elevation={el.toFixed(1)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <defs>
          <radialGradient id="lm-dome" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={light.skyGradient[0]} stopOpacity={compact ? 0.55 : 0.9} />
            <stop offset="100%" stopColor={light.skyGradient[2]} stopOpacity={compact ? 0.55 : 0.9} />
          </radialGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="url(#lm-dome)" stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        {['N', 'E', 'S', 'W'].map((n, i) => (
          <text key={n} x={c + (r + 9) * Math.cos(rad(i * 90))} y={c + (r + 9) * Math.sin(rad(i * 90)) + 4} textAnchor="middle" fontSize={compact ? 10 : 13} fill="rgba(255,255,255,0.8)" fontWeight={n === 'N' ? 700 : 400}>
            {n}
          </text>
        ))}
        {path ? <path d={path} fill="none" stroke="var(--lm-sun)" strokeOpacity={0.6} strokeWidth={compact ? 1.5 : 2.5} strokeDasharray="3 4" /> : null}
        {/* camera heading wedge */}
        <path d={`M${c},${c} L${c + r * Math.cos(rad(camHeading - scene.camera.fovDeg / 2))},${c + r * Math.sin(rad(camHeading - scene.camera.fovDeg / 2))} A${r},${r} 0 0 1 ${c + r * Math.cos(rad(camHeading + scene.camera.fovDeg / 2))},${c + r * Math.sin(rad(camHeading + scene.camera.fovDeg / 2))} Z`} fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
        {up && shadowLen > 0 ? <line x1={c} y1={c} x2={shx} y2={shy} stroke="rgba(0,0,0,0.75)" strokeWidth={compact ? 4 : 8} strokeLinecap="round" /> : null}
        {up ? (
          <>
            <line x1={c} y1={c} x2={sx} y2={sy} stroke="var(--lm-sun)" strokeWidth={compact ? 2 : 3} strokeLinecap="round" />
            <circle cx={sx} cy={sy} r={compact ? 6 : 12} fill="var(--lm-sun)" stroke="#7a4a00" strokeWidth={2} />
          </>
        ) : (
          <circle cx={c} cy={c} r={compact ? 5 : 10} fill="var(--lm-twilight)" opacity={0.8} />
        )}
        <circle cx={c} cy={c} r={compact ? 3 : 5} fill="#fff" stroke="#000" strokeWidth={1.5} />
      </svg>
      {!compact ? (
        <figcaption className="max-w-sm text-center text-sm text-[var(--lm-text-muted)]">{label}</figcaption>
      ) : null}
    </figure>
  );
}

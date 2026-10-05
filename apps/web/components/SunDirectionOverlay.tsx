'use client';
/**
 * Quality-0 overlay (plan §6): compass rose with sun arrow, shadow arrow, the day's sun path, the
 * year's sunrise/sunset arcs and the Moon when it is up.
 * Always correct, always available, driven by SceneState only. In 3D mode it shrinks to a corner
 * compass; in overlay mode it is the hero.
 */
import { lightingFromScene } from '@lightmap/renderer';
import { rangeWidthDeg, type SceneState } from '@lightmap/scene';
import { compassLabel } from '@lightmap/geospatial';
import { sunPosition } from '@lightmap/astronomy';
import { useMemo } from 'react';
import { useSeasonalEnvelope } from '@/features/planner/use-seasonal';

/** Bearing (0 = north, clockwise) → SVG angle with north at the top. */
const rad = (d: number) => ((d - 90) * Math.PI) / 180;

/** An SVG arc on a circle of radius `radius` about (c, c), clockwise from bearing a to b. */
function bearingArc(c: number, radius: number, range: [number, number]): string {
  const [a, b] = range;
  const large = rangeWidthDeg(range) > 180 ? 1 : 0;
  return `M${(c + radius * Math.cos(rad(a))).toFixed(1)},${(c + radius * Math.sin(rad(a))).toFixed(1)} A${radius},${radius} 0 ${large} 1 ${(c + radius * Math.cos(rad(b))).toFixed(1)},${(c + radius * Math.sin(rad(b))).toFixed(1)}`;
}

export function SunDirectionOverlay({ scene, compact }: { scene: SceneState; compact: boolean }) {
  const light = lightingFromScene(scene);
  const seasons = useSeasonalEnvelope(scene);
  const size = compact ? 132 : 300;
  const r = size / 2 - 14;
  const c = size / 2;
  const az = scene.solar.azimuthDegrees;
  const el = scene.solar.elevationDegrees;
  const up = el > -0.833;
  // Sun marker: radius shrinks toward the centre as the sun climbs (an "orthographic" sky dome).
  const sunR = r * Math.cos(Math.max(0, el) * (Math.PI / 180));
  const sx = c + sunR * Math.cos(rad(az));
  const sy = c + sunR * Math.sin(rad(az));
  const path = useMemo(() => {
    const pts: string[] = [];
    const start = scene.dayEvents.dayStart.getTime();
    const end = scene.dayEvents.dayEnd.getTime();
    for (let t = start; t <= end; t += 10 * 60_000) {
      const p = sunPosition(
        new Date(t),
        scene.location.point.latitude,
        scene.location.point.longitude,
      );
      if (p.elevationDeg < 0) continue;
      const rr = r * Math.cos(p.elevationDeg * (Math.PI / 180));
      pts.push(
        `${(c + rr * Math.cos(rad(p.azimuthDeg))).toFixed(1)},${(c + rr * Math.sin(rad(p.azimuthDeg))).toFixed(1)}`,
      );
    }
    return pts.length > 1 ? `M${pts.join(' L')}` : '';
  }, [
    scene.dayEvents.dayStart,
    scene.dayEvents.dayEnd,
    scene.location.point.latitude,
    scene.location.point.longitude,
    r,
    c,
  ]);
  const shadowAz = light.shadow.azimuthDeg;
  const shadowLen =
    light.shadow.lengthPerMetre === null
      ? 0
      : Math.min(r * 0.9, r * 0.25 * Math.min(4, light.shadow.lengthPerMetre));
  const shx = c + shadowLen * Math.cos(rad(shadowAz));
  const shy = c + shadowLen * Math.sin(rad(shadowAz));
  const camHeading = scene.camera.headingDeg;
  // The Moon when it is up (moon planning): a grey disc on the same dome, no ray or shadow.
  const moon = scene.lunar && scene.lunar.isAboveHorizon ? scene.lunar : null;
  const moonR = moon ? r * Math.cos(Math.max(0, moon.elevationDegrees) * (Math.PI / 180)) : 0;
  const mx = moon ? c + moonR * Math.cos(rad(moon.azimuthDegrees)) : 0;
  const my = moon ? c + moonR * Math.sin(rad(moon.azimuthDegrees)) : 0;

  const label =
    (up
      ? `Sun at ${Math.round(el)}° elevation, bearing ${Math.round(az)}° (${compassLabel(az)}). Shadows fall toward ${compassLabel(shadowAz)}.`
      : `Sun ${Math.abs(Math.round(el))}° below the horizon (${scene.solar.phase.replace('-', ' ')}).`) +
    (moon
      ? ` Moon at ${Math.round(moon.elevationDegrees)}° elevation, bearing ${Math.round(moon.azimuthDegrees)}° (${compassLabel(moon.azimuthDegrees)}), ${Math.round(moon.illuminatedFraction * 100)} % lit.`
      : '');

  return (
    <figure
      className={
        compact
          ? 'pointer-events-none absolute right-3 top-3 z-10'
          : 'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 p-6'
      }
      aria-label="Sun direction"
      data-testid="sun-direction-overlay"
      data-sun-azimuth={az.toFixed(1)}
      data-sun-elevation={el.toFixed(1)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <defs>
          <radialGradient id="lm-dome" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={light.skyGradient[0]} stopOpacity={compact ? 0.55 : 0.9} />
            <stop
              offset="100%"
              stopColor={light.skyGradient[2]}
              stopOpacity={compact ? 0.55 : 0.9}
            />
          </radialGradient>
        </defs>
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="url(#lm-dome)"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={1}
        />
        {/* Seasonal envelope (plan §1): the year's sunrise and sunset bearings as rim arcs,
            under the compass letters. */}
        {[seasons.sunriseRange, seasons.sunsetRange].map((range, i) =>
          range ? (
            <path
              key={i}
              d={bearingArc(c, r + 2, range)}
              fill="none"
              stroke="var(--lm-sun)"
              strokeOpacity={0.45}
              strokeWidth={2}
              strokeLinecap="butt"
              data-testid={i === 0 ? 'seasonal-sunrise-arc' : 'seasonal-sunset-arc'}
            />
          ) : null,
        )}
        {['N', 'E', 'S', 'W'].map((n, i) => (
          <text
            key={n}
            x={c + (r + 9) * Math.cos(rad(i * 90))}
            y={c + (r + 9) * Math.sin(rad(i * 90)) + 4}
            textAnchor="middle"
            fontSize={compact ? 10 : 13}
            fill="rgba(255,255,255,0.8)"
            fontWeight={n === 'N' ? 700 : 400}
          >
            {n}
          </text>
        ))}
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="var(--lm-sun)"
            strokeOpacity={0.6}
            strokeWidth={compact ? 1.5 : 2.5}
            strokeDasharray="3 4"
          />
        ) : null}
        {/* camera heading wedge */}
        <path
          d={`M${c},${c} L${c + r * Math.cos(rad(camHeading - scene.camera.fovDeg / 2))},${c + r * Math.sin(rad(camHeading - scene.camera.fovDeg / 2))} A${r},${r} 0 0 1 ${c + r * Math.cos(rad(camHeading + scene.camera.fovDeg / 2))},${c + r * Math.sin(rad(camHeading + scene.camera.fovDeg / 2))} Z`}
          fill="rgba(255,255,255,0.10)"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={1}
        />
        {up && shadowLen > 0 ? (
          <line
            x1={c}
            y1={c}
            x2={shx}
            y2={shy}
            stroke="rgba(0,0,0,0.75)"
            strokeWidth={compact ? 4 : 8}
            strokeLinecap="round"
          />
        ) : null}
        {up ? (
          <>
            <line
              x1={c}
              y1={c}
              x2={sx}
              y2={sy}
              stroke="var(--lm-sun)"
              strokeWidth={compact ? 2 : 3}
              strokeLinecap="round"
            />
            <circle
              cx={sx}
              cy={sy}
              r={compact ? 6 : 12}
              fill="var(--lm-sun)"
              stroke="#7a4a00"
              strokeWidth={2}
            />
          </>
        ) : (
          <circle cx={c} cy={c} r={compact ? 5 : 10} fill="var(--lm-twilight)" opacity={0.8} />
        )}
        {moon ? (
          <circle
            cx={mx}
            cy={my}
            r={compact ? 4 : 8}
            fill="#d8dde6"
            fillOpacity={0.35 + 0.65 * moon.illuminatedFraction}
            stroke="#1f2430"
            strokeWidth={1.5}
            data-testid="rose-moon"
          />
        ) : null}
        <circle cx={c} cy={c} r={compact ? 3 : 5} fill="#fff" stroke="#000" strokeWidth={1.5} />
      </svg>
      {!compact ? (
        <figcaption className="max-w-sm text-center text-sm text-[var(--lm-text-muted)]">
          {label}
        </figcaption>
      ) : null}
    </figure>
  );
}

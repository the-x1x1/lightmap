/**
 * SceneState → concrete lighting parameters for the renderer. Pure, so the mapping is unit
 * tested and the same numbers drive both the Cesium scene and the Quality-0 CSS overlay.
 */
import type { SceneState } from '@lightmap/scene';
import { kelvinToRgb } from '@lightmap/weather';
import { shadowOnGround, sunLightDirectionEcef, type Vec3 } from './sun-vector.ts';

export interface LightingParameters {
  /** Sun → ground direction in ECEF for DirectionalLight. */
  sunDirectionEcef: Vec3;
  /** Linear RGB tint of direct light (1,1,1 = neutral). */
  sunColor: [number, number, number];
  /** Direct light intensity multiplier (Cesium `light.intensity`; 1 ≈ clear noon). */
  sunIntensity: number;
  /** Whether the Sun is far enough above the horizon to light anything directly. */
  directLightPresent: boolean;
  /** Shadow map darkness 0..1 as Cesium defines it: 0 = black shadows, 1 = no visible shadow. */
  shadowDarkness: number;
  shadowsEnabled: boolean;
  /** Sky-atmosphere shifts (Cesium: hue/saturation/brightness deltas around 0). */
  atmosphere: { hueShift: number; saturationShift: number; brightnessShift: number; lightIntensity: number };
  /** Fog density (Cesium `scene.fog.density`), driven by haze. */
  fogDensity: number;
  /** Post-process grade uniforms. */
  grade: {
    saturation: number;
    contrast: number;
    warmth: number;
    tint: [number, number, number];
    haze: number;
    cloudCoverage: number;
    cloudDensity: number;
    cloudOpacity: number;
    skyLuminance: number;
    nightFactor: number;
    precipitation: number;
  };
  /** Flat-ground shadow geometry for the 2D overlay. */
  shadow: { azimuthDeg: number; lengthPerMetre: number | null };
  /** CSS sky gradient stops (top → horizon) for the overlay and preview chrome. */
  skyGradient: [string, string, string];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Smoothstep on [a, b]. */
function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function lightingFromScene(s: SceneState): LightingParameters {
  const { solar, atmosphere, location } = s;
  const el = solar.elevationDegrees;
  const p = atmosphere.parameters;

  // Direct sunlight fades in from the horizon (atmospheric extinction) and is cut by cloud.
  const horizonFade = smooth(-0.833, 4, el) * (0.55 + 0.45 * smooth(4, 25, el));
  const sunIntensity = 2.2 * horizonFade * p.sunTransmittance;
  const directLightPresent = el > -0.833 && p.sunTransmittance > 0.12;

  // Colour: black-body tint from elevation, desaturated toward white as cloud diffuses it.
  const tint = kelvinToRgb(atmosphere.colorTemperatureK);
  const mixToWhite = p.diffuseFraction * 0.6;
  const sunColor: [number, number, number] = [tint[0] + (1 - tint[0]) * mixToWhite, tint[1] + (1 - tint[1]) * mixToWhite, tint[2] + (1 - tint[2]) * mixToWhite];

  // Shadows: darkness rises (shadows fade) as diffuse light takes over; off when no direct light.
  const shadowDarkness = clamp01(0.25 + 0.75 * p.diffuseFraction - 0.15 * smooth(0, 30, el));
  const shadowsEnabled = s.render.shadows && directLightPresent;

  const nightFactor = 1 - smooth(-18, 0, el);
  const twilightWarm = smooth(-6, 0, el) * (1 - smooth(6, 20, el)); // peaks at the horizon
  const atmosphereHue = 0.03 * twilightWarm;
  const atmosphereSaturation = -0.35 * p.cloudOpacity + 0.1 * twilightWarm;
  const atmosphereBrightness = -0.25 * p.cloudOpacity - 0.05 * p.haze + 0.2 * (p.skyLuminance - 1);
  const fogDensity = 0.00002 + 0.0009 * p.haze;

  const skyGradient = skyGradientFor(el, p.cloudOpacity, atmosphere.warmth, p.skyLuminance);

  return {
    sunDirectionEcef: sunLightDirectionEcef(solar.azimuthDegrees, el, location.point.latitude, location.point.longitude),
    sunColor,
    sunIntensity,
    directLightPresent,
    shadowDarkness,
    shadowsEnabled,
    atmosphere: { hueShift: atmosphereHue, saturationShift: atmosphereSaturation, brightnessShift: atmosphereBrightness, lightIntensity: 20 * (0.4 + 0.6 * (1 - nightFactor)) },
    fogDensity,
    grade: {
      saturation: p.saturation,
      contrast: p.contrast,
      warmth: atmosphere.warmth,
      tint,
      haze: p.haze,
      cloudCoverage: p.cloudCover,
      cloudDensity: p.cloudDensity,
      cloudOpacity: p.cloudOpacity,
      skyLuminance: p.skyLuminance,
      nightFactor,
      precipitation: p.precipitation,
    },
    shadow: shadowOnGround(solar.azimuthDegrees, el),
    skyGradient,
  };
}

/** Three CSS colours: zenith, mid-sky, horizon. */
export function skyGradientFor(elevationDeg: number, cloudOpacity: number, warmth: number, skyLuminance: number): [string, string, string] {
  const day = smooth(-6, 8, elevationDeg);
  const night = 1 - smooth(-18, -6, elevationDeg);
  const horizonGlow = smooth(-8, -1, elevationDeg) * (1 - smooth(1, 12, elevationDeg));
  const lum = 0.6 + 0.4 * skyLuminance;

  // Base blues (clear day) → greys (overcast) → deep navy (night).
  const zenithClear: [number, number, number] = [58, 120, 200];
  const midClear: [number, number, number] = [110, 165, 225];
  const horizonClear: [number, number, number] = [190, 215, 235];
  const overcast: [number, number, number] = [150, 155, 162];
  const nightZenith: [number, number, number] = [6, 9, 20];
  const nightHorizon: [number, number, number] = [18, 24, 48];
  const glow: [number, number, number] = warmth > 0.55 ? [255, 150, 70] : [120, 140, 210];

  const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const build = (clear: [number, number, number], nightC: [number, number, number], glowAmount: number): string => {
    let c = mix(clear, overcast, cloudOpacity);
    c = mix(c, nightC, night);
    c = mix(c, nightC, (1 - day) * (1 - night) * 0.5);
    c = mix(c, glow, glowAmount * (1 - cloudOpacity * 0.7));
    const l = 1 - (1 - lum) * (1 - night);
    return `rgb(${Math.round(c[0] * l)}, ${Math.round(c[1] * l)}, ${Math.round(c[2] * l)})`;
  };
  return [build(zenithClear, nightZenith, 0), build(midClear, mix(nightZenith, nightHorizon, 0.5), horizonGlow * 0.3), build(horizonClear, nightHorizon, horizonGlow)];
}

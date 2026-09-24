/**
 * SceneState → concrete lighting parameters for the renderer. Pure, so the mapping is unit
 * tested and the same numbers drive both the Cesium scene and the Quality-0 CSS overlay.
 */
import type { SceneState } from '@lightmap/scene';
import { kelvinToRgb } from '@lightmap/weather';
import { shadowOnGround, sunLightDirectionEcef, type Vec3 } from './sun-vector.ts';

export interface LightingParameters {
  /** True Sun → ground direction in ECEF (for overlays and the ephemeris cross-check). */
  sunDirectionEcef: Vec3;
  /**
   * Direction handed to the renderer's DirectionalLight. Equal to `sunDirectionEcef` while the Sun
   * is up. During twilight the elevation is clamped to a grazing −1.5°: Cesium's single-scattering
   * sky goes black the moment its light source dips below the horizon, whereas a real twilight sky
   * stays lit by multiple scattering. The grade shader then darkens and blues the sky by
   * `nightFactor`, so the result is a luminous blue hour rather than instant night.
   */
  lightDirectionEcef: Vec3;
  /** Stars/skybox should be visible (Sun well below the horizon). */
  starsVisible: boolean;
  /** Scene is lit by the Moon (Sun < −12°, Moon up); light direction is then the Moon's. */
  moonlit: boolean;
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
  atmosphere: {
    hueShift: number;
    saturationShift: number;
    brightnessShift: number;
    lightIntensity: number;
  };
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
    /**
     * Aerial perspective toward the horizon: the scenario's haze plus the longer atmospheric path
     * at low sun. Applied to ground pixels by depth in the grade shader; never to geometry.
     */
    horizonHaze: number;
    /** Geometric sun elevation, degrees (shader-side twilight shaping). */
    sunElevation: number;
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
  const direct = 2.2 * horizonFade * p.sunTransmittance;
  // Twilight ambient: a dim, cool, horizon-grazing light so the ground is not black during blue
  // hour (Cesium's globe has no sky-ambient term). Peaks just below the horizon, gone by −14°.
  const twilightAmbient =
    0.35 * smooth(-14, -1, el) * (1 - smooth(-1, 3, el)) * (0.6 + 0.4 * p.diffuseFraction);
  // Moonlight: once the Sun is well down and the Moon is up, the scene's light comes from the
  // Moon — dim, cool, from the Moon's direction. Shadows stay off (too faint to be honest about).
  const moon = s.lunar;
  const moonUp = moon !== null && moon.isAboveHorizon;
  const moonlight = moonUp ? 0.14 * moon.illuminatedFraction * (1 - smooth(-18, -12, el)) : 0;
  const moonlit = moonlight > 0.005;
  const sunIntensity = direct + twilightAmbient + moonlight;
  const directLightPresent = el > -0.833 && p.sunTransmittance > 0.12;
  // Clamp to a grazing angle through twilight; below −18° the sky is genuinely dark. Cesium's
  // single-scattering dome collapses within ~1° of the light dipping under the horizon, so the
  // clamp sits just under it and the grade shader restores the real blue-hour darkening.
  const lightElevation = el >= -0.6 ? el : el > -18 ? -0.6 : el;
  const starsVisible = el < -8;

  // Colour: black-body tint from elevation, desaturated toward white as cloud diffuses it.
  const tint = kelvinToRgb(atmosphere.colorTemperatureK);
  const mixToWhite = p.diffuseFraction * 0.6;
  const moonTint: [number, number, number] = [0.78, 0.86, 1];
  const sunColorBase: [number, number, number] = [
    tint[0] + (1 - tint[0]) * mixToWhite,
    tint[1] + (1 - tint[1]) * mixToWhite,
    tint[2] + (1 - tint[2]) * mixToWhite,
  ];
  const moonWeight = sunIntensity > 0 ? moonlight / sunIntensity : 0;
  const sunColor: [number, number, number] = [
    sunColorBase[0] + (moonTint[0] - sunColorBase[0]) * moonWeight,
    sunColorBase[1] + (moonTint[1] - sunColorBase[1]) * moonWeight,
    sunColorBase[2] + (moonTint[2] - sunColorBase[2]) * moonWeight,
  ];

  // Shadows: darkness rises (shadows fade) as diffuse light takes over; off when no direct light.
  const shadowDarkness = clamp01(0.25 + 0.75 * p.diffuseFraction - 0.15 * smooth(0, 30, el));
  const shadowsEnabled = s.render.shadows && directLightPresent;

  const nightFactor = 1 - smooth(-18, 0, el);
  // Twilight lift for the sky dome: the atmosphere is lit at a grazing angle, so give it more
  // energy while the Sun is just below the horizon; the grade shader brings the level back down.
  const twilightBoost = 1 + 1.6 * smooth(-14, -2, el) * (1 - smooth(-2, 0, el));
  // Low sun: the zenith dome is dim in single scattering; real skies keep a medium blue from
  // multiple scattering. Lift brightness a little between −6° and +12°.
  const lowSunLift = 0.12 * smooth(-6, 0, el) * (1 - smooth(4, 14, el));
  const horizonHaze = clamp01(
    p.haze + 0.35 * smooth(-6, 2, el) * (1 - smooth(2, 15, el)) * (1 - 0.5 * p.cloudOpacity),
  );
  const twilightWarm = smooth(-6, 0, el) * (1 - smooth(6, 20, el)); // peaks at the horizon
  const atmosphereHue = 0.03 * twilightWarm;
  const atmosphereSaturation = -0.35 * p.cloudOpacity + 0.1 * twilightWarm;
  const atmosphereBrightness =
    -0.25 * p.cloudOpacity - 0.05 * p.haze + 0.2 * (p.skyLuminance - 1) + lowSunLift;
  const fogDensity = 0.00002 + 0.0009 * p.haze;

  const skyGradient = skyGradientFor(el, p.cloudOpacity, atmosphere.warmth, p.skyLuminance);

  return {
    sunDirectionEcef: sunLightDirectionEcef(
      solar.azimuthDegrees,
      el,
      location.point.latitude,
      location.point.longitude,
    ),
    lightDirectionEcef:
      moonlit && el < -12 && moon
        ? sunLightDirectionEcef(
            moon.azimuthDegrees,
            Math.max(moon.elevationDegrees, 2),
            location.point.latitude,
            location.point.longitude,
          )
        : sunLightDirectionEcef(
            solar.azimuthDegrees,
            lightElevation,
            location.point.latitude,
            location.point.longitude,
          ),
    starsVisible,
    moonlit,
    sunColor,
    sunIntensity,
    directLightPresent,
    shadowDarkness,
    shadowsEnabled,
    atmosphere: {
      hueShift: atmosphereHue,
      saturationShift: atmosphereSaturation,
      brightnessShift: atmosphereBrightness,
      // Moonlit: the atmosphere's lobe around the light becomes the Moon's halo; keep it modest.
      lightIntensity: 20 * (0.4 + 0.6 * (1 - nightFactor)) * twilightBoost * (moonlit ? 0.3 : 1),
    },
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
      horizonHaze,
      sunElevation: el,
    },
    shadow: shadowOnGround(solar.azimuthDegrees, el),
    skyGradient,
  };
}

/** Three CSS colours: zenith, mid-sky, horizon. */
export function skyGradientFor(
  elevationDeg: number,
  cloudOpacity: number,
  warmth: number,
  skyLuminance: number,
): [string, string, string] {
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

  const mix = (
    a: [number, number, number],
    b: [number, number, number],
    t: number,
  ): [number, number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const build = (
    clear: [number, number, number],
    nightC: [number, number, number],
    glowAmount: number,
  ): string => {
    let c = mix(clear, overcast, cloudOpacity);
    c = mix(c, nightC, night);
    c = mix(c, nightC, (1 - day) * (1 - night) * 0.5);
    c = mix(c, glow, glowAmount * (1 - cloudOpacity * 0.7));
    const l = 1 - (1 - lum) * (1 - night);
    return `rgb(${Math.round(c[0] * l)}, ${Math.round(c[1] * l)}, ${Math.round(c[2] * l)})`;
  };
  return [
    build(zenithClear, nightZenith, 0),
    build(midClear, mix(nightZenith, nightHorizon, 0.5), horizonGlow * 0.3),
    build(horizonClear, nightHorizon, horizonGlow),
  ];
}

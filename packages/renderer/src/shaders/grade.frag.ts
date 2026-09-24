/**
 * Post-process "grade" stage. Runs over the final frame and applies the weather scenario:
 *   - three procedural cloud decks over sky pixels (depth == far): low / mid / high cover from the
 *     forecast layers or the scenario, each lit according to the true Sun elevation;
 *   - haze (aerial perspective) that lifts blacks toward the sky colour with distance;
 *   - contrast, saturation and a colour-temperature tint;
 *   - overcast/night dimming of the sky luminance;
 *   - a light rain streak texture when precipitation > 0.
 *
 * It never moves geometry or the light: those come from terrain and SolarState (plan §1E, §25
 * Phase 8 rules apply to any future "realism" work too).
 *
 * Exported as a string because Cesium's PostProcessStage takes GLSL source. Cesium supplies
 * `colorTexture`, `depthTexture` and `v_textureCoordinates`; we add our uniforms.
 */
export const GRADE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;

uniform float u_saturation;
uniform float u_contrast;
uniform float u_warmth;
uniform vec3  u_tint;
uniform float u_haze;
uniform float u_cloudCoverage;
uniform float u_cloudDensity;
uniform float u_cloudOpacity;
uniform float u_cloudLow;       // per-band cover 0..1 (forecast layers or the scenario's split)
uniform float u_cloudMid;
uniform float u_cloudHigh;
uniform float u_skyLuminance;
uniform float u_nightFactor;
uniform float u_precipitation;
uniform float u_horizonHaze;    // aerial perspective toward the horizon (scenario haze + low sun)
uniform float u_sunElevation;   // degrees, geometric
uniform float u_time;
uniform vec2  u_sunScreen;      // sun position in 0..1 screen space (may be off-screen)
uniform float u_sunVisible;     // 1 when the sun is above the horizon and not blocked by cloud

// --- value noise / fbm -------------------------------------------------------------------
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int k = 0; k < 5; k++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return v;
}

vec3 saturate3(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}

void main() {
  vec4 src = texture(colorTexture, v_textureCoordinates);
  vec3 color = src.rgb;
  float depth = czm_readDepth(depthTexture, v_textureCoordinates);
  bool isSky = depth >= 1.0 - 1e-6;

  // Sky: three procedural cloud decks — high (cirrus), mid (alto-), low (stratus/cumulus) — each
  // with the cover the forecast (or scenario) gives that band, composited far to near. Cloud
  // *placement* is noise; cloud *amount per band* and *how each band is lit* follow the data and
  // the true Sun elevation. Scroll slowly so scrubbing time reads as "the sky moves".
  if (isSky) {
    vec2 uv = v_textureCoordinates;
    // The clear dome first (Cesium's single-scattering sky, corrected for twilight), then the
    // decks composite over it — a cloud's colour comes from how *it* is lit, not from the dome.
    vec3 dome = color * (0.95 + 0.15 * u_skyLuminance);
    dome *= mix(1.0, u_skyLuminance, 0.6);
    // Twilight → night: the atmosphere is lit at a grazing angle (see lighting.ts), so darken and
    // cool the sky here as the real Sun sinks. Blue hour keeps ~65 % luminance with a blue cast;
    // astronomical night ends near black.
    float twilight = smoothstep(0.0, 1.0, u_nightFactor);
    dome = mix(dome, dome * vec3(0.55, 0.68, 1.05), twilight * 0.8);
    // Blue hour proper (sun −6°…0°): the dome is lit only by multiple scattering, which the
    // single-scattering sky model cannot produce — restore the deep, saturated blue and a little
    // of the luminance it loses. Peaks around −4°, gone by −12° (nautical twilight is dark).
    float blueHour = (1.0 - smoothstep(-6.0, 0.5, u_sunElevation)) * smoothstep(-12.0, -6.0, u_sunElevation);
    // The bright band where the sun set stays warm (forward scattering); only the dome goes blue.
    float glowKeep = smoothstep(0.35, 0.8, dot(dome, vec3(0.2126, 0.7152, 0.0722)));
    dome = mix(dome, dome * vec3(0.75, 0.9, 1.45) * 1.5 + vec3(0.0, 0.015, 0.06), blueHour * 0.85 * (1.0 - 0.75 * glowKeep));
    dome = mix(dome, dome * vec3(1.12, 0.93, 0.78), blueHour * glowKeep * 0.7);
    // Darken the atmospheric glow but keep bright point sources (stars, moon) readable.
    float domeLum = dot(dome, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(0.12, 0.5, domeLum);
    dome = mix(dome * mix(1.0, 0.06, twilight), dome, keep);
    vec3 sky = dome;
    // Clouds share the scene's sky-luminance dimming (overcast decks are darker than fair ones).
    float deckLum = mix(1.0, u_skyLuminance, 0.6);
    // How each deck is lit. A cloud at height h over the observer stays in sunlight until the Sun
    // is acos(R/(R+h)) below the horizon (+~0.5° refraction): ≈1° for a 1 km base, ≈2° at 4 km,
    // ≈3.5–4° at 10–12 km. So low cloud goes into shadow at sunset while cirrus stays lit — and
    // pink — for another 15–20 minutes. Geometry, not taste.
    float sunUp   = smoothstep(-1.2, 1.5, u_sunElevation);
    float midLit  = smoothstep(-2.5, -0.5, u_sunElevation);
    float highLit = smoothstep(-4.0, -2.5, u_sunElevation);
    // Direct light reaching a cloud is warm from the golden hour down: fully orange-red once the
    // Sun is below the observer's horizon (the beam has crossed the whole atmosphere twice).
    float lowSun  = 1.0 - smoothstep(-1.0, 8.0, u_sunElevation);
    vec3 warm  = vec3(1.0, 0.62, 0.42);
    vec3 shade = vec3(0.35, 0.40, 0.55);   // unlit cloud under a twilight sky
    // If a caller sends no per-band cover, the total drives the low deck (legacy behaviour).
    float noBands = step(u_cloudLow + u_cloudMid + u_cloudHigh, 0.001);
    float covHigh = clamp(u_cloudHigh, 0.0, 1.0);
    float covMid  = clamp(u_cloudMid, 0.0, 1.0);
    float covLow  = clamp(max(u_cloudLow, u_cloudCoverage * noBands), 0.0, 1.0);

    // High deck: cirrus. Fibrous, stretched along the wind; thin, so it brightens more than it hides.
    if (covHigh > 0.005) {
      vec2 ph = vec2(uv.x * 2.2 + u_time * 0.006, (uv.y - 0.5) * 9.0 + u_time * 0.0008);
      // Streaks run along the horizon (the wind shear that makes cirrus fibrous), so the noise is
      // sampled at a low x frequency and a high y frequency.
      float nh = fbm(ph * vec2(0.5, 1.0) + vec2(3.1, 7.7));
      float fibres = fbm(ph * vec2(1.5, 3.0) + vec2(1.0, 2.0));
      float veil = smoothstep(1.0 - covHigh - 0.18, 1.0 - covHigh + 0.18, nh) * (0.55 + 0.45 * fibres);
      vec3 cirrus = mix(vec3(0.92, 0.94, 0.98), warm, lowSun * 0.9);
      cirrus = mix(shade * 0.6, cirrus, highLit);
      cirrus *= deckLum * mix(1.0, 0.25, u_nightFactor * (1.0 - highLit));
      sky = mix(sky, cirrus, veil * (0.5 + 0.35 * covHigh));
    }

    // Mid deck: altostratus / altocumulus. A smoother grey-white sheet; the Sun shows through as a disc.
    if (covMid > 0.005) {
      vec2 pm = vec2(uv.x * 2.6 + u_time * 0.005, (uv.y - 0.5) * 6.5 + u_time * 0.001);
      float nm = fbm(pm + vec2(11.0, 5.0));
      float sheet = smoothstep(1.0 - covMid - 0.2, 1.0 - covMid + 0.2, nm);
      vec3 alto = mix(vec3(0.86, 0.87, 0.90), vec3(0.62, 0.64, 0.68), covMid * 0.7);
      alto = mix(alto, alto * warm * 1.1, lowSun * 0.5 * midLit);
      alto = mix(shade * 0.5, alto, midLit);
      alto *= deckLum * mix(1.0, 0.2, u_nightFactor * (1.0 - midLit));
      sky = mix(sky, alto, sheet * (0.55 + 0.35 * covMid));
    }

    // Low deck: stratus / cumulus with dark bases; thickness from the scenario density.
    if (covLow > 0.005) {
      vec2 p = vec2(uv.x * 3.0 + u_time * 0.004, (uv.y - 0.5) * 6.0 + u_time * 0.001);
      float n = fbm(p);
      float cloud = smoothstep(1.0 - covLow - 0.15, 1.0 - covLow + 0.15, n);
      float thickness = clamp(u_cloudDensity * (0.5 + 0.5 * u_cloudOpacity), 0.0, 1.0);
      vec3 cloudCol = mix(vec3(1.0, 1.0, 1.0), vec3(0.55, 0.58, 0.62), thickness);
      // Thick decks are not flat: a low-contrast second octave keeps overcast reading as cloud, not fog.
      cloudCol *= 1.0 + (fbm(p * 2.7 + vec2(5.0, 3.0)) - 0.5) * 0.28 * thickness;
      // Dense cores are darker than the sunlit edges.
      cloudCol *= mix(1.0, 0.78, thickness * smoothstep(0.55, 0.9, n));
      // Broken low cloud catches warm light on its undersides while the Sun is low but up.
      cloudCol = mix(cloudCol, cloudCol * warm, lowSun * sunUp * 0.7 * (1.0 - thickness));
      cloudCol = mix(cloudCol, cloudCol * u_tint, 0.35 * (1.0 - thickness) * sunUp);
      cloudCol = mix(shade * 0.45, cloudCol, sunUp);
      cloudCol *= deckLum * mix(1.0, 0.15, u_nightFactor * (1.0 - sunUp));
      sky = mix(sky, cloudCol, cloud * (0.75 + 0.25 * thickness));
    }
    color = sky;
  } else {
    // Aerial perspective: lift toward the sky colour with distance. Depth is non-linear; use a
    // steep curve so only the far ground near the horizon is affected. Low sun lengthens the
    // path through the air (u_horizonHaze), and the haze takes the light's colour.
    float d = clamp(depth, 0.0, 1.0);
    float dist = pow(d, 60.0);
    vec3 hazeCol = mix(vec3(0.72, 0.78, 0.86), vec3(0.6, 0.62, 0.66), u_cloudOpacity);
    hazeCol = mix(hazeCol, hazeCol * u_tint, 0.5 * (1.0 - u_cloudOpacity));
    hazeCol = mix(hazeCol, vec3(0.05, 0.06, 0.1), u_nightFactor);
    color = mix(color, hazeCol, clamp(u_horizonHaze * dist * 0.9, 0.0, 0.85));
  }

  // Global grade.
  color = saturate3(color, u_saturation);
  color = (color - 0.5) * u_contrast + 0.5;
  // Colour temperature tint of the whole frame, strongest in direct light, weak in overcast.
  float tintAmount = mix(0.35, 0.12, u_cloudOpacity);
  color *= mix(vec3(1.0), u_tint, tintAmount);

  // Rain streaks.
  if (u_precipitation > 0.01) {
    vec2 r = v_textureCoordinates * vec2(220.0, 18.0) + vec2(0.0, -u_time * 3.0);
    float streak = smoothstep(0.93, 1.0, vnoise(r)) * smoothstep(0.6, 1.0, vnoise(r * 0.37 + 11.0));
    color = mix(color, color * 0.8 + vec3(0.18), streak * u_precipitation * 0.8);
  }

  out_FragColor = vec4(clamp(color, 0.0, 1.0), src.a);
}
`;

export const GRADE_UNIFORM_NAMES = [
  'u_saturation',
  'u_contrast',
  'u_warmth',
  'u_tint',
  'u_haze',
  'u_cloudCoverage',
  'u_cloudDensity',
  'u_cloudOpacity',
  'u_cloudLow',
  'u_cloudMid',
  'u_cloudHigh',
  'u_skyLuminance',
  'u_nightFactor',
  'u_precipitation',
  'u_horizonHaze',
  'u_sunElevation',
  'u_time',
  'u_sunScreen',
  'u_sunVisible',
] as const;

/**
 * Post-process "grade" stage. Runs over the final frame and applies the weather scenario:
 *   - procedural cloud layer over sky pixels (depth == far), coverage/density from the scenario;
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

  // Sky: procedural clouds. Scroll slowly so scrubbing time reads as "the sky moves".
  if (isSky) {
    vec2 uv = v_textureCoordinates;
    // Stretch toward the horizon (bottom half of the frame usually); keep it cheap.
    vec2 p = vec2(uv.x * 3.0 + u_time * 0.004, (uv.y - 0.5) * 6.0 + u_time * 0.001);
    float n = fbm(p);
    float coverage = clamp(u_cloudCoverage, 0.0, 1.0);
    // Threshold the noise so coverage maps to the fraction of sky that is cloud.
    float cloud = smoothstep(1.0 - coverage - 0.15, 1.0 - coverage + 0.15, n);
    float thickness = clamp(u_cloudDensity * (0.5 + 0.5 * u_cloudOpacity), 0.0, 1.0);
    // Cloud colour: bright white lit by the sun when thin/scattered, grey when dense/overcast.
    vec3 skyLit = color * (0.95 + 0.15 * u_skyLuminance);
    vec3 cloudCol = mix(vec3(1.0, 1.0, 1.0), vec3(0.55, 0.58, 0.62), thickness);
    // Thick decks are not flat: a low-contrast second octave keeps overcast reading as cloud, not fog.
    cloudCol *= 1.0 + (fbm(p * 2.7 + vec2(5.0, 3.0)) - 0.5) * 0.28 * thickness;
    cloudCol = mix(cloudCol, cloudCol * (0.35 + 0.65 * (1.0 - u_nightFactor)), u_nightFactor);
    cloudCol = mix(cloudCol, cloudCol * u_tint, 0.35 * (1.0 - thickness));
    color = mix(skyLit, cloudCol, cloud * u_cloudOpacity * (0.6 + 0.4 * thickness));
    color *= mix(1.0, u_skyLuminance, 0.6);
    // Twilight → night: the atmosphere is lit at a grazing angle (see lighting.ts), so darken and
    // cool the sky here as the real Sun sinks. Blue hour keeps ~65 % luminance with a blue cast;
    // astronomical night ends near black.
    float twilight = smoothstep(0.0, 1.0, u_nightFactor);
    color = mix(color, color * vec3(0.55, 0.68, 1.05), twilight * 0.8);
    // Blue hour proper (sun −6°…0°): the dome is lit only by multiple scattering, which the
    // single-scattering sky model cannot produce — restore the deep, saturated blue and a little
    // of the luminance it loses. Peaks around −4°, gone by −12° (nautical twilight is dark).
    float blueHour = (1.0 - smoothstep(-6.0, 0.5, u_sunElevation)) * smoothstep(-12.0, -6.0, u_sunElevation);
    // The bright band where the sun set stays warm (forward scattering); only the dome goes blue.
    float glowKeep = smoothstep(0.35, 0.8, dot(color, vec3(0.2126, 0.7152, 0.0722)));
    color = mix(color, color * vec3(0.75, 0.9, 1.45) * 1.5 + vec3(0.0, 0.015, 0.06), blueHour * 0.85 * (1.0 - 0.75 * glowKeep));
    color = mix(color, color * vec3(1.12, 0.93, 0.78), blueHour * glowKeep * 0.7);
    // Darken the atmospheric glow but keep bright point sources (stars, moon) readable.
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(0.12, 0.5, lum);
    color = mix(color * mix(1.0, 0.06, twilight), color, keep);
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
  'u_skyLuminance',
  'u_nightFactor',
  'u_precipitation',
  'u_horizonHaze',
  'u_sunElevation',
  'u_time',
  'u_sunScreen',
  'u_sunVisible',
] as const;

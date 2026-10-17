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
uniform vec3 u_eyeUpEC;         // the local up at the camera, in eye coordinates (per frame)
uniform float u_eyeHeightM;     // the camera's height above the ellipsoid (per frame)
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
  // "No depth" is read from the depth as stored (logarithmic), where only what nothing was
  // drawn over reaches 1: czm_readDepth's perspective depth is within 1e-6 of 1 from about
  // 100 km out (near plane 0.1 m), so the far ridges that stand above the horizon were taken
  // for sky and drawn as it - a black band along the horizon (V&V: Tromso at polar noon).
  float storedDepth = texture(depthTexture, v_textureCoordinates).r;
  bool noDepth = storedDepth >= 1.0 - 1e-6;
  // Sky is what the view ray reaches past the Earth, not merely "no depth": ground not yet
  // drawn (terrain still loading, or out in another frustum) also reads as no depth, and the
  // cloud decks painted over it turned a whole overcast valley into a grey sheet. So a ray
  // that meets the Earth (a sphere of the polar radius) is never sky, whatever the depth.
  // The view ray's elevation against the camera's own horizontal (the host passes the local up
  // in eye space and the camera's height each frame); below the horizon's dip it meets the Earth.
  vec4 nearEC = czm_inverseProjection * vec4(v_textureCoordinates * 2.0 - 1.0, -1.0, 1.0);
  vec3 rayEC = normalize(nearEC.xyz / nearEC.w);
  float horizonDip = sqrt(2.0 * max(u_eyeHeightM, 0.0) / 6371000.0);
  bool hitsEarth = asin(clamp(dot(rayEC, u_eyeUpEC), -1.0, 1.0)) < -horizonDip;
  bool isSky = noDepth && !hitsEarth;
  // The decks are a sky seen from under them: from above ~10 km (an orbit) there are none, and
  // space around the globe stays dark.
  float underDecks = 1.0 - smoothstep(6000.0, 14000.0, u_eyeHeightM);

  // Sky: three procedural cloud decks - high (cirrus), mid (alto-), low (stratus/cumulus) - each
  // with the cover the forecast (or scenario) gives that band, composited far to near. Cloud
  // *placement* is noise; cloud *amount per band* and *how each band is lit* follow the data and
  // the true Sun elevation. Scroll slowly so scrubbing time reads as "the sky moves".
  if (isSky) {
    vec2 uv = v_textureCoordinates;
    // The star field comes out through the twilight (lighting.ts \`starFieldVisibility\`): it is
    // drawn from a Sun at -4 deg, and until -15 deg part of each star's light is taken back out.
    // A star is a point brighter than every pixel a star's width away (a texel of the 1024-px
    // star cube, 0.088 deg, as drawn at this lens: a few pixels, dozens zoomed in); a disc's
    // limb (the Moon) or a cloud edge always has a neighbour as bright on its inside, so those
    // keep their light.
    float starFade = 1.0 - smoothstep(-15.0, -4.0, u_sunElevation);
    if (starFade < 1.0 && u_sunElevation < -3.5) {
      float pixelRad = 2.0 * atan(1.0 / czm_projection[1][1]) / czm_viewport.w;
      float reach = clamp(1.5 * 0.001534 / max(pixelRad, 1e-6), 2.0, 24.0);
      vec2 px = reach / czm_viewport.zw;
      vec3 around = texture(colorTexture, uv + vec2(px.x, 0.0)).rgb;
      around = max(around, texture(colorTexture, uv - vec2(px.x, 0.0)).rgb);
      around = max(around, texture(colorTexture, uv + vec2(0.0, px.y)).rgb);
      around = max(around, texture(colorTexture, uv - vec2(0.0, px.y)).rgb);
      around = max(around, texture(colorTexture, uv + px * 0.7071).rgb);
      around = max(around, texture(colorTexture, uv - px * 0.7071).rgb);
      around = max(around, texture(colorTexture, uv + vec2(px.x, -px.y) * 0.7071).rgb);
      around = max(around, texture(colorTexture, uv + vec2(-px.x, px.y) * 0.7071).rgb);
      color -= max(color - around, vec3(0.0)) * (1.0 - starFade);
    }
    // The clear dome first (Cesium's single-scattering sky, corrected for twilight), then the
    // decks composite over it - a cloud's colour comes from how *it* is lit, not from the dome.
    vec3 dome = color * (0.95 + 0.15 * u_skyLuminance);
    dome *= mix(1.0, u_skyLuminance, 0.6);
    // Twilight -> night: the atmosphere is lit at a grazing angle (see lighting.ts), so darken and
    // cool the sky here as the real Sun sinks. Blue hour keeps ~65 % luminance with a blue cast;
    // astronomical night ends near black.
    float twilight = smoothstep(0.0, 1.0, u_nightFactor);
    dome = mix(dome, dome * vec3(0.55, 0.68, 1.05), twilight * 0.8);
    // Blue hour proper (sun -6 deg...0 deg): the dome is lit only by multiple scattering, which the
    // single-scattering sky model cannot produce - restore the deep, saturated blue and a little
    // of the luminance it loses. Peaks around -4 deg, gone by -12 deg (nautical twilight is dark).
    float blueHour = (1.0 - smoothstep(-6.0, 0.5, u_sunElevation)) * smoothstep(-12.0, -6.0, u_sunElevation);
    // The bright band where the sun set stays warm (forward scattering); only the dome goes blue.
    float glowKeep = smoothstep(0.35, 0.8, dot(dome, vec3(0.2126, 0.7152, 0.0722)));
    dome = mix(dome, dome * vec3(0.75, 0.9, 1.45) * 1.5 + vec3(0.0, 0.015, 0.06), blueHour * 0.85 * (1.0 - 0.75 * glowKeep));
    dome = mix(dome, dome * vec3(1.12, 0.93, 0.78), blueHour * glowKeep * 0.7);
    // With the Sun just under the horizon the glow over it is yellow to orange, never white: the
    // dome there comes in clipped to white (single scattering, boosted for twilight), so the
    // whitest of it takes the glow's colour back. Gone by -9 deg; above the horizon the white
    // around the Sun is its glare and stays.
    float underSun = (1.0 - smoothstep(-1.0, 0.5, u_sunElevation)) * smoothstep(-9.0, -5.0, u_sunElevation);
    float whiteness = smoothstep(0.7, 0.95, min(dome.r, min(dome.g, dome.b)));
    dome = mix(dome, dome * vec3(1.0, 0.8, 0.52), whiteness * underSun * 0.85);
    // Darken the atmospheric glow but keep bright point sources (stars, moon) readable.
    float domeLum = dot(dome, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(0.12, 0.5, domeLum);
    dome = mix(dome * mix(1.0, 0.06, twilight), dome, keep);
    // Opposite a low Sun: the single-scattering dome leaves the eastern sky at sunset (the
    // western at sunrise) a dull dark teal, where a photographer finds the Earth's shadow, a
    // blue-grey band rising from the horizon as the Sun sinks, under the pink Belt of Venus,
    // and the whole twilight sky lit a little by light scattered more than once (V&V: Erg
    // Chebbi at sunset, looking east). From the Sun about 4 deg up to about 7 deg down, in a
    // clear sky, strongest straight opposite the Sun.
    {
      vec3 up = u_eyeUpEC;
      vec3 sunH = czm_sunDirectionEC - dot(czm_sunDirectionEC, up) * up;
      vec3 rayH = rayEC - dot(rayEC, up) * up;
      float anti = clamp(-dot(normalize(rayH + 1e-6), normalize(sunH + 1e-6)), 0.0, 1.0);
      anti = anti * anti;
      float window = smoothstep(-7.0, -1.0, u_sunElevation) * (1.0 - smoothstep(1.5, 4.5, u_sunElevation));
      float clear = 1.0 - u_cloudOpacity;
      float elevDeg = degrees(asin(clamp(dot(rayEC, up), -1.0, 1.0)));
      float shadowTop = 0.5 + max(0.0, -u_sunElevation);
      float earthShadow = 1.0 - smoothstep(shadowTop - 1.0, shadowTop + 2.0, elevDeg);
      float belt = smoothstep(shadowTop, shadowTop + 3.0, elevDeg) * (1.0 - smoothstep(shadowTop + 6.0, shadowTop + 20.0, elevDeg));
      dome += window * clear * (anti * (belt * vec3(0.38, 0.25, 0.29) + earthShadow * vec3(0.10, 0.13, 0.19))
          + vec3(0.04, 0.06, 0.10));
    }
    vec3 sky = dome;
    // Clouds share the scene's sky-luminance dimming (overcast decks are darker than fair ones).
    float deckLum = mix(1.0, u_skyLuminance, 0.6);
    // How each deck is lit. A cloud at height h over the observer stays in sunlight until the Sun
    // is acos(R/(R+h)) below the horizon - 1.0 deg for a 1 km base, 2.0 deg at 4 km, 3.2-3.5 deg at
    // 10-12 km (R = 6371 km) - plus ~0.5 deg of refraction: ~1.5 deg, ~2.5 deg, ~3.7-4.0 deg. Each ramp is
    // centred on its band's typical height, so low cloud goes into shadow just after sunset while
    // cirrus stays lit - and pink - for another 15-20 minutes. The transition is applied across
    // the whole sky; a real deck stays lit a little longer toward the Sun (known simplification).
    float sunUp   = smoothstep(-2.0, -0.5, u_sunElevation);
    float midLit  = smoothstep(-3.0, -1.5, u_sunElevation);
    float highLit = smoothstep(-4.5, -3.0, u_sunElevation);
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
    color = mix(dome, sky, underDecks);
  } else {
    // Aerial perspective: lift toward the sky colour with the real distance through the air
    // (the depth turned back into eye space - a curve on raw depth, which is logarithmic and
    // per-frustum, put a camera 1.5 km over a valley into 85 % haze). The visibility follows
    // the scenario's haze (about 60 km clear, 20 km overcast, 4 km in thick haze, the fog's
    // own scale), shortened when a low Sun lengthens the path (u_horizonHaze); the haze takes
    // the light's colour.
    // czm_windowToEyeCoordinates takes the depth as stored (logarithmic), not czm_readDepth's
    // reversed value - given that, it put everything at an enormous distance.
    vec4 eyePos = czm_windowToEyeCoordinates(v_textureCoordinates * czm_viewport.zw, storedDepth);
    float distM = length(eyePos.xyz / eyePos.w);
    // Ground with no depth is ground not drawn yet (terrain still loading): it hazes as the
    // sea-level sphere the ray meets would, at least 20 km out, rather than not at all.
    if (noDepth) {
      float eyeH = max(u_eyeHeightM, 0.0);
      float b = (6371000.0 + eyeH) * dot(rayEC, u_eyeUpEC);
      distM = -b - sqrt(max(b * b - (2.0 * 6371000.0 * eyeH + eyeH * eyeH), 0.0));
      distM = max(distM, 20000.0);
    }
    // Haze lives near the ground: along a path that climbs out of it (a camera looking down
    // from above) the optical depth is that of an exponential layer with a 1 km scale height,
    // not of the whole distance at ground density.
    float visibilityM = 4000.0 * pow(20.0, 1.0 - clamp(u_haze, 0.0, 1.0))
        / (1.0 + 2.0 * max(0.0, u_horizonHaze - u_haze));
    float dh = -dot(rayEC, u_eyeUpEC) * distM;   // how far the path descends, metres
    float layer = abs(dh) < 1.0 ? 1.0 : 1000.0 * (1.0 - exp(-abs(dh) / 1000.0)) / abs(dh);
    float dist = 1.0 - exp(-3.0 * distM * layer / visibilityM);
    vec3 hazeCol = mix(vec3(0.72, 0.78, 0.86), vec3(0.6, 0.62, 0.66), u_cloudOpacity);
    hazeCol = mix(hazeCol, hazeCol * u_tint, 0.5 * (1.0 - u_cloudOpacity));
    hazeCol = mix(hazeCol, vec3(0.05, 0.06, 0.1), u_nightFactor);
    color = mix(color, hazeCol, clamp(dist * 0.85, 0.0, 0.85));
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
  'u_eyeUpEC',
  'u_eyeHeightM',
] as const;

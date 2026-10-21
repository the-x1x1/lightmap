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
const GRADE_SOURCE = /* glsl */ `
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
uniform float u_starField;      // 1 while the star field is drawn (the host's skybox)
uniform float u_atmosphereDark; // 1 when the atmosphere is dark of itself (no held light, no Moon)
// The naked-eye planets (Mercury, Venus, Mars, Jupiter, Saturn): screen xy (0..1), the point's
// peak brightness (0: not drawn) and its Gaussian radius in CSS pixels (planet-points.ts).
uniform vec4 u_planet0;
uniform vec4 u_planet1;
uniform vec4 u_planet2;
uniform vec4 u_planet3;
uniform vec4 u_planet4;
uniform vec3 u_sunDirEC;        // toward the Sun, eye coordinates (per frame, gliding)
uniform vec3 u_sunTint;         // the colour of the Sun's direct light at its elevation
uniform vec3 u_moonDirEC;       // toward the Moon, eye coordinates (per frame)
uniform float u_moonGlow;       // the Moon's aureole, 0 none - 1 a full Moon in a dark sky
uniform float u_moonRadiusDeg;  // the Moon's disc radius as drawn, degrees (0: no disc)

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

// The dimmest and the brightest of eight samples on a ring px (in uv) round uv.
vec3 ringMin(vec2 uv, vec2 px) {
  vec3 m = texture(colorTexture, uv + vec2(px.x, 0.0)).rgb;
  m = min(m, texture(colorTexture, uv - vec2(px.x, 0.0)).rgb);
  m = min(m, texture(colorTexture, uv + vec2(0.0, px.y)).rgb);
  m = min(m, texture(colorTexture, uv - vec2(0.0, px.y)).rgb);
  m = min(m, texture(colorTexture, uv + px * 0.7071).rgb);
  m = min(m, texture(colorTexture, uv - px * 0.7071).rgb);
  m = min(m, texture(colorTexture, uv + vec2(px.x, -px.y) * 0.7071).rgb);
  return min(m, texture(colorTexture, uv + vec2(-px.x, px.y) * 0.7071).rgb);
}
vec3 ringMax(vec2 uv, vec2 px) {
  vec3 m = texture(colorTexture, uv + vec2(px.x, 0.0)).rgb;
  m = max(m, texture(colorTexture, uv - vec2(px.x, 0.0)).rgb);
  m = max(m, texture(colorTexture, uv + vec2(0.0, px.y)).rgb);
  m = max(m, texture(colorTexture, uv - vec2(0.0, px.y)).rgb);
  m = max(m, texture(colorTexture, uv + px * 0.7071).rgb);
  m = max(m, texture(colorTexture, uv - px * 0.7071).rgb);
  m = max(m, texture(colorTexture, uv + vec2(px.x, -px.y) * 0.7071).rgb);
  return max(m, texture(colorTexture, uv + vec2(-px.x, px.y) * 0.7071).rgb);
}

// A planet's point on the dome at this pixel.
vec3 planetLight(vec4 p, vec3 tint) {
  if (p.z <= 0.0) return vec3(0.0);
  vec2 d = (v_textureCoordinates - p.xy) * czm_viewport.zw;
  float s = p.w * czm_pixelRatio;
  float r2 = dot(d, d);
  if (r2 > 36.0 * s * s) return vec3(0.0);
  return tint * p.z * exp(-r2 / (2.0 * s * s));
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
    // drawn from a Sun at -8 deg, and until -16 deg part of each star's light is held back - none
    // of it shows at -8, half at -12. Gated on the host's own skybox switch, not on the gliding
    // elevation, so a step across -8 deg never shows the field whole for a frame.
    // A star is a point brighter than every pixel a star's width away: 1.5 texels of the
    // 1024-px star cube (0.088 deg), as drawn along this ray (a gnomonic view magnifies by
    // 1/cos^2 off its axis): a few pixels, dozens zoomed in. The Moon's limb and a crescent have
    // a neighbour about as bright on their inside, so they keep their light; the cloud decks are
    // composited after this, so their edges are never touched.
    float starFade = 1.0 - smoothstep(-16.0, -8.0, u_sunElevation);
    // The stars' own light, taken out of the sky before it is graded and put back after: the
    // grading below is for the atmosphere (darkened and cooled through the twilight, when Cesium
    // still lights it from a Sun held at the horizon), and it had turned the stars blue and
    // crushed the fainter ones to nothing at night.
    vec3 starLight = vec3(0.0);
#ifdef LM_NIGHT
    if (u_starField > 0.5) {
      // A star-width out (1.5 texels of the 1024-px star cube, as drawn along this ray, at
      // least 3 px): the dimmest of a ring there is the sky behind; and the pixel must stand
      // clearly above everything on a ring twice as far for it to be a point at all. A pixel on a star's skirt sees sky
      // in both rings, so the whole star separates (one ring tested both, and left the skirts
      // in the sky to be tinted blue); the Moon's disc, wider than the outer ring, never does.
      float cosAxis = max(-rayEC.z, 0.2);
      float reach = clamp(
          1.5 * 0.001534 * czm_projection[1][1] * czm_viewport.w * 0.5 / (cosAxis * cosAxis),
          3.0, 32.0);
      vec2 px = reach / czm_viewport.zw;
      vec3 lumW = vec3(0.2126, 0.7152, 0.0722);
      float lumHere = dot(color, lumW);
      float lumOuter = dot(ringMax(uv, px * 2.0), lumW);
      if (lumHere > lumOuter * 1.05 + 0.002) {
        starLight = max(color - ringMin(uv, px), vec3(0.0));
        color -= starLight;
      }
    }
#endif
    // The Moon's disc keeps the colour it was drawn in (its phase, and the low Moon's orange):
    // it is translucent so the decks can cover it, which also put it through the sky's grading
    // and turned it pale blue at night.
    float moonDisc = 0.0;
    vec3 moonColour = src.rgb;
    if (u_moonRadiusDeg > 0.0) {
      float am = degrees(acos(clamp(dot(rayEC, u_moonDirEC), -1.0, 1.0)));
      // A pixel and a half beyond the limb as well (a few-pixel Moon at a wide lens is all limb).
      float pixelDeg = degrees(2.0 / (czm_projection[1][1] * czm_viewport.w));
      moonDisc = 1.0 - smoothstep(u_moonRadiusDeg * 0.92,
          u_moonRadiusDeg * 1.08 + 0.01 + 1.5 * pixelDeg, am);
      // Only the lit part: a crescent's dark side is a faint earthshine over the sky, and kept
      // ungraded it stood out as a pale ghost of the full disc.
      moonDisc *= smoothstep(0.15, 0.4, dot(src.rgb, vec3(0.2126, 0.7152, 0.0722)));
    }
    // The clear dome first (Cesium's single-scattering sky, corrected for twilight), then the
    // decks composite over it - a cloud's colour comes from how *it* is lit, not from the dome.
    vec3 dome = color * (0.95 + 0.15 * u_skyLuminance);
    dome *= mix(1.0, u_skyLuminance, 0.6);
    // Twilight -> night: the atmosphere is lit at a grazing angle (see lighting.ts), so darken and
    // cool the sky here as the real Sun sinks. Blue hour keeps ~65 % luminance with a blue cast;
    // astronomical night ends near black.
    float twilight = smoothstep(0.0, 1.0, u_nightFactor);
    // Below -18 deg the scene's light is no longer held at the horizon (lighting.ts): Cesium's
    // atmosphere is dark of itself, and what is left on the dome is the star field's own glow -
    // the Milky Way. The darkening and the cooling let go of it over the next 2 deg, so the band
    // comes out at astronomical night instead of being cut to a sixteenth.
    // Only while the controller says so (u_atmosphereDark: set with the light, not glided, so a
    // scrub up across -18 deg never lets go of a dome lit again): a Moon lighting the sky - the
    // scene's light is then the Moon's, at any phase - keeps the darkening, and washes the band
    // out as it does the real one.
    float trueNight = u_atmosphereDark * (1.0 - smoothstep(-20.0, -18.0, u_sunElevation));
    dome = mix(dome, dome * vec3(0.55, 0.68, 1.05), twilight * 0.8 * (1.0 - 0.7 * trueNight));
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
    // The Sun's disc and its glow take the colour of its light: Cesium draws them one white-yellow
    // at every height, so a setting Sun was a white disc in an orange sky. Within a few degrees of
    // it the sky is tinted by the direct-light colour for its elevation (white from 20 deg up,
    // orange on the horizon); seen from under the decks only.
    {
      float a = degrees(acos(clamp(dot(rayEC, u_sunDirEC), -1.0, 1.0)));
      // Only while the disc is up: under the horizon the glow's colour is the block above's.
      float nearSun = (1.0 - smoothstep(0.5, 6.0, a)) * underDecks
          * smoothstep(-1.5, -0.5, u_sunElevation);
      dome = mix(dome, dome * u_sunTint, nearSun);
    }
    // Darken the atmospheric glow but keep bright point sources (stars, moon) readable.
    float domeLum = dot(dome, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(0.12, 0.5, domeLum);
    dome = mix(dome * mix(1.0, 0.06, twilight * (1.0 - trueNight)), dome, keep);
    // The stars back, neutral, as much of them as the twilight shows; the Moon as drawn.
#ifdef LM_NIGHT
    dome += starLight * starFade;
#endif
    dome = mix(dome, moonColour, moonDisc);
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
    // The planets: points on the clear dome after the stars have faded and the twilight is
    // graded, before the decks, so cloud covers them and a ridge (not sky) hides them.
#ifdef LM_NIGHT
    dome += planetLight(u_planet0, vec3(1.0, 0.93, 0.82))
        + planetLight(u_planet1, vec3(1.0, 0.98, 0.92))
        + planetLight(u_planet2, vec3(1.0, 0.70, 0.50))
        + planetLight(u_planet3, vec3(1.0, 0.95, 0.86))
        + planetLight(u_planet4, vec3(1.0, 0.91, 0.72));
#endif
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
    // What each deck lays over this pixel (the Moon's aureole reads them below).
    float veilHere = 0.0;
    float sheetHere = 0.0;
    float lowHere = 0.0;

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
      veilHere = veil;
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
      sheetHere = sheet;
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
      lowHere = cloud * thickness;
    }
    // The Moon's aureole: moonlight scattered forward by the haze and by thin cloud around it -
    // a tight glow and a wide one, both stronger in haze and far stronger through cirrus or a
    // thin altostratus sheet (the halo a night photographer frames, or waits out), and muffled
    // under a thick low deck. Cesium's sky scatters no moonlight, so without this the Moon sat
    // in a black sky however hazy the night.
#ifdef LM_NIGHT
    if (u_moonGlow > 0.0) {
      float a = degrees(acos(clamp(dot(rayEC, u_moonDirEC), -1.0, 1.0)));
      // The cloud at this pixel, not the deck's cover: the gaps between cirrus fibres glow as
      // the haze does; a mid sheet scatters as a thin veil while sparse, and muffles once dense.
      float thin = clamp(veilHere * 0.9 + sheetHere * 0.5 * (1.0 - 0.7 * covMid), 0.0, 1.0);
      float hazy = clamp(u_haze, 0.0, 1.0);
      float near = exp(-a / 2.5) * (0.05 + 0.10 * hazy + 0.30 * thin);
      float wide = exp(-a / 18.0) * (0.012 + 0.035 * hazy + 0.05 * thin);
      float muffled = (1.0 - 0.8 * lowHere) * (1.0 - 0.6 * sheetHere * covMid);
      sky += vec3(1.0, 0.96, 0.9) * u_moonGlow * (near + wide) * muffled;
    }
#endif
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

/**
 * The grade with everything the night sky needs (the stars' light kept out of the grading, the
 * planets, the Moon's aureole): the host draws it while the star field, a planet or the aureole
 * is shown.
 */
export const GRADE_FRAGMENT_SHADER = `#define LM_NIGHT\n${GRADE_SOURCE}`;

/**
 * The grade without the night sky's parts, drawn the rest of the time. A GPU skips a branch the
 * whole of a block of pixels takes, but a software renderer (SwiftShader: CI's browsers, a
 * machine with no usable GPU) pays for every line however it branches: there the planets alone
 * doubled the cost of the grade at noon, when none can be up.
 */
export const GRADE_DAY_FRAGMENT_SHADER = GRADE_SOURCE;

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
  'u_starField',
  'u_atmosphereDark',
  'u_planet0',
  'u_planet1',
  'u_planet2',
  'u_planet3',
  'u_planet4',
  'u_sunDirEC',
  'u_sunTint',
  'u_moonDirEC',
  'u_moonGlow',
  'u_moonRadiusDeg',
] as const;

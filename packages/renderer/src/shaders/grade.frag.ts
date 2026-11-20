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
uniform vec3 u_eyeEastEC;       // the local east at the camera, in eye coordinates (per frame)
uniform vec2 u_windToward;      // where the wind blows the decks, a unit vector east and north
uniform vec2 u_eyeFromPlaceKm;  // the camera east and north of the place, km (per frame)
uniform float u_windMps;        // the wind's speed, m/s
uniform float u_lowDeckKm;      // the low deck's base over the place's ground, km
uniform float u_dust;           // the region's aridity, 0..1: how much of the haze is dust
uniform float u_eyeHeightM;     // the camera's height above the ellipsoid (per frame)
uniform float u_hazeBaseM;      // the ground's height at the place (where its visibility is measured)
uniform float u_cloudCoverage;
uniform float u_cloudDensity;
uniform float u_cloudOpacity;
uniform float u_cloudLow;       // per-band cover 0..1 (forecast layers or the scenario's split)
uniform float u_cloudMid;
uniform float u_cloudHigh;
uniform float u_skyLuminance;
uniform float u_nightFactor;
uniform float u_precipitation;
uniform float u_snowfall;        // the share of the precipitation falling as snow, times it: 0..1
uniform float u_rainbow;         // a rainbow's strength, 0..1 (showers in sunlight)
uniform float u_rays;            // sunbeams' strength, 0..1 (a low Sun through hazy air)
uniform float u_mist;            // valley mist's strength, 0..1 (calm, near-saturated early air)
uniform float u_mistFloorM;      // the low ground about the place, where the mist lies (ellipsoid m)
uniform float u_horizonHaze;    // aerial perspective toward the horizon (scenario haze + low sun)
uniform float u_sunElevation;   // degrees, geometric
uniform float u_time;
uniform vec2  u_sunScreen;      // sun position in 0..1 screen space (may be off-screen)
uniform float u_sunVisible;     // 1 when the sun is above the horizon and not blocked by cloud
uniform float u_starField;      // 1 while the star field is drawn (the host's skybox)
uniform float u_atmosphereDark; // 1 when the atmosphere is dark of itself (no held light, no Moon)
uniform vec3 u_hazeAway;        // the sky at the horizon away from the Sun (what distant ground hazes toward)
uniform vec3 u_hazeToward;      // the same on the Sun's side (the glow at a low Sun)
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
uniform vec4 u_townGlow;        // the towns' glow: x strength 0..1, y all-round share, z lights on (host)
uniform vec3 u_townGlowDirEC;   // toward the strongest glow, eye coordinates (per frame)
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
// Where a ray from the eye meets a cloud deck hKm above it: km east and north of the place, in a
// frame fixed to the ground (the local east and north at the camera, the eye's own offset from
// the place added), so a deck stays put in the sky as the camera turns or travels, crowds toward
// the horizon as a real one does, and casts its shadow where the ground material reads it. A ray nearer the
// horizon than 2 deg is held there (the deck beyond is read as its mean, below).
vec2 deckPoint(vec3 ray, float hKm) {
  vec3 up = u_eyeUpEC;
  vec3 east = normalize(u_eyeEastEC - dot(u_eyeEastEC, up) * up);
  vec3 north = cross(up, east);
  float ru = max(dot(ray, up), 0.035);
  return vec2(dot(ray, east), dot(ray, north)) * (hKm / ru) + u_eyeFromPlaceKm;
}

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
    // The decks' heights over the eye - low at the forecast's cloud base (1.5 km without one),
    // mid 4 km, cirrus 9 km above the place's ground - and how much of each one's detail the view resolves: toward the horizon a deck
    // is so foreshortened that it reads as its mean, and a deck at or below the eye (a camera
    // high over the ground) is not overhead at all.
    float groundKm = u_hazeBaseM / 1000.0;
    float eyeKm = u_eyeHeightM / 1000.0;
    float hLow = u_lowDeckKm + groundKm - eyeKm;
    float hMid = 4.0 + groundKm - eyeKm;
    float hHigh = 9.0 + groundKm - eyeKm;
    float detail = smoothstep(0.03, 0.14, dot(rayEC, u_eyeUpEC));
    // The decks in the wind's frame - x downwind, y across it - so the cirrus streaks lie along
    // the wind and every deck drifts downwind with the scene's clock: the wind aloft taken as
    // 2.5 times the surface's, the clock wrapped every four days (a drift of thousands of km
    // would cost the noise its precision).
    vec2 wTo = normalize(u_windToward + vec2(1e-6, 0.0));
    vec2 wAcross = vec2(-wTo.y, wTo.x);
    float driftKm = mod(u_time, 5760.0) * u_windMps * 2.5 * 0.06;
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
      vec2 dh = deckPoint(rayEC, max(hHigh, 0.3));
      vec2 ph = vec2(dot(dh, wTo) - driftKm, dot(dh, wAcross)) / 15.0;
      // Streaks run along the horizon (the wind shear that makes cirrus fibrous), so the noise is
      // sampled at a low x frequency and a high y frequency.
      float nh = mix(0.5, fbm(ph * vec2(0.5, 1.0) + vec2(3.1, 7.7)), detail) - step(hHigh, 0.0);
      float fibres = mix(0.5, fbm(ph * vec2(1.5, 3.0) + vec2(1.0, 2.0)), detail);
      float veil = smoothstep(1.0 - covHigh - 0.18, 1.0 - covHigh + 0.18, nh) * (0.55 + 0.45 * fibres);
      vec3 cirrus = mix(vec3(0.92, 0.94, 0.98), warm, lowSun * 0.9);
      cirrus = mix(shade * 0.6, cirrus, highLit);
      cirrus *= deckLum * mix(1.0, 0.25, u_nightFactor * (1.0 - highLit));
      // The Sun through it: a cirrus sheet passes most of the direct beam (55-85 %), so its disc
      // shows through, bright, in a glow the ice scatters forward round it - a tight one and a
      // wide one (painted over at the veil's full strength, the Sun had gone, leaving a dull
      // grey where the brightest thing in the sky should be).
      float aSunV = degrees(acos(clamp(dot(rayEC, u_sunDirEC), -1.0, 1.0)));
      float sunUpV = smoothstep(-0.5, 1.0, u_sunElevation);
      float throughV = (1.0 - smoothstep(0.35, 1.2, aSunV)) * sunUpV;
      sky = mix(sky, cirrus, veil * (0.5 + 0.35 * covHigh) * (1.0 - 0.8 * throughV));
      // The disc itself drawn as the veil takes over (the dome's own is faint by then): the
      // Sun's 0.53 deg, white-hot, in the tight glow and the wide one.
      float discV = 1.0 - smoothstep(0.22, 0.32, aSunV);
      sky += mix(vec3(1.0, 0.97, 0.92), warm, lowSun * 0.8)
          * (discV * 1.2 + exp(-aSunV / 1.2) * 0.55 + exp(-aSunV / 8.0) * 0.10)
          * veil * sunUpV * highLit * deckLum;
      veilHere = veil;
      // Halos: a cirrostratus sheet's ice crystals turn the light by 22 deg at least, so round
      // the Sun stands a ring of that radius, sharp and reddish on its inside edge, fading
      // white outward, the sky darker inside it; and with a low Sun the plate crystals throw
      // two sun dogs at the Sun's height either side, red toward the Sun, gone as it climbs past
      // about 40 deg. In the veil itself (patchy where it is) and as strong as the sheet is
      // wide (scattered cirrus seldom makes one). The Moon makes the same ring by night.
      float sheetLike = smoothstep(0.35, 0.8, covHigh) * veil;
      if (sheetLike > 0.0) {
        vec3 up = u_eyeUpEC;
        float sunUpH = smoothstep(-0.5, 1.0, u_sunElevation) * highLit;
        float a = degrees(acos(clamp(dot(rayEC, u_sunDirEC), -1.0, 1.0)));
        float ring = exp(-pow((a - 22.7) / 1.2, 2.0)) * smoothstep(21.6, 22.3, a);
        vec3 ringCol = mix(vec3(1.0, 0.70, 0.52), vec3(1.0), smoothstep(22.3, 24.5, a));
        float inside = 1.0 - smoothstep(20.5, 22.0, a);
        float sEl = asin(clamp(dot(u_sunDirEC, up), -1.0, 1.0));
        float rEl = asin(clamp(dot(rayEC, up), -1.0, 1.0));
        vec3 sH = normalize(u_sunDirEC - dot(u_sunDirEC, up) * up + 1e-6);
        vec3 rH = normalize(rayEC - dot(rayEC, up) * up + 1e-6);
        float dAz = degrees(acos(clamp(dot(sH, rH), -1.0, 1.0)));
        float cS = max(cos(sEl), 0.3);
        float dogAz = degrees(acos(clamp((cos(radians(22.0)) - sin(sEl) * sin(sEl)) / (cS * cS), -1.0, 1.0)));
        float dog = exp(-pow((dAz - dogAz) / 1.1, 2.0) - pow(degrees(rEl - sEl) / 1.5, 2.0))
            * (1.0 - smoothstep(30.0, 42.0, degrees(sEl)));
        vec3 dogCol = mix(vec3(1.0, 0.62, 0.42), vec3(1.0, 0.98, 0.92), smoothstep(-0.6, 1.2, dAz - dogAz));
        sky = sky * (1.0 - 0.06 * inside * sheetLike * sunUpH)
            + (ringCol * ring * 0.10 + dogCol * dog * 0.30) * sheetLike * sunUpH * deckLum;
#ifdef LM_NIGHT
        if (u_moonGlow > 0.0) {
          float am = degrees(acos(clamp(dot(rayEC, u_moonDirEC), -1.0, 1.0)));
          float mring = exp(-pow((am - 22.7) / 1.3, 2.0)) * smoothstep(21.6, 22.3, am);
          sky += vec3(0.95, 0.95, 1.0) * mring * 0.05 * u_moonGlow * sheetLike;
        }
#endif
      }
    }

    // Mid deck: altostratus / altocumulus. A smoother grey-white sheet; the Sun shows through as a disc.
    if (covMid > 0.005) {
      vec2 dm = deckPoint(rayEC, max(hMid, 0.3));
      vec2 pm = vec2(dot(dm, wTo) - driftKm, dot(dm, wAcross)) / 5.5;
      float nm = mix(0.5, fbm(pm + vec2(11.0, 5.0)), detail) - step(hMid, 0.0);
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
      vec2 dl = deckPoint(rayEC, max(hLow, 0.3));
      vec2 p = vec2(dot(dl, wTo) - driftKm, dot(dl, wAcross)) / 1.8;
      float nRaw = fbm(p);
      // Broken low cloud is cumulus, not a smear: its edge is ragged - three finer octaves (down
      // to 30 m, mean zero, so the cover is the forecast's still) fray it into wisps - and a
      // little firmer than a closing deck's. A deck closing past 45-70 % goes back to stratus's
      // soft edge and even base (the overcast scenario's 75 % is a deck, as bright as it was),
      // and toward the horizon the detail gives way to the mean as before.
      float cumulus = (1.0 - smoothstep(0.45, 0.7, covLow)) * detail;
      float rag = 0.0;
      if (cumulus > 0.01) {
        rag = 0.5 * (vnoise(p * 6.1 + vec2(3.1, 7.7)) - 0.5)
            + 0.3 * (vnoise(p * 13.7 + vec2(9.4, 1.3)) - 0.5)
            + 0.2 * (vnoise(p * 29.3 + vec2(5.6, 2.9)) - 0.5);
      }
      float n = mix(0.5, nRaw + 0.14 * cumulus * rag, detail) - step(hLow, 0.0);
      float edge = mix(0.15, 0.10, cumulus);
      float cloud = smoothstep(1.0 - covLow - edge, 1.0 - covLow + edge, n);
      // How deep in the cloud this is: 0 at its edge, 1 well inside.
      float depth = clamp((n - (1.0 - covLow)) / 0.25, 0.0, 1.0);
      float thickness = clamp(u_cloudDensity * (0.5 + 0.5 * u_cloudOpacity), 0.0, 1.0);
      vec3 cloudCol = mix(vec3(1.0, 1.0, 1.0), vec3(0.55, 0.58, 0.62), thickness);
      // Thick decks are not flat: a low-contrast second octave keeps overcast reading as cloud, not fog.
      float lumps = fbm(p * 2.7 + vec2(5.0, 3.0));
      cloudCol *= 1.0 + (lumps - 0.5) * 0.28 * thickness;
      // Dense cores are darker than the sunlit edges.
      cloudCol *= mix(1.0, 0.78, thickness * smoothstep(0.55, 0.9, n));
      // A cumulus has a body: its thin margins are white with the light scattered through
      // them, and seen from below it greys toward its middle (the light has been spent on the
      // way down), in lumps; and it is lit from the Sun's side - where the cloud thins toward
      // the Sun its face is in sunlight, where it thickens it is in its own shade. One more
      // reading of the field 0.4 km toward the Sun gives which; with the Sun overhead the step
      // shrinks to nothing and only the grey base is left, as from under a noon cumulus.
      if (cumulus > 0.01) {
        cloudCol *= 1.0 - cumulus * 0.3 * depth * (0.6 + 0.8 * lumps);
        vec3 upV = u_eyeUpEC;
        vec3 eastV = normalize(u_eyeEastEC - dot(u_eyeEastEC, upV) * upV);
        vec2 sunEN = vec2(dot(u_sunDirEC, eastV), dot(u_sunDirEC, cross(upV, eastV)));
        float relief = clamp((nRaw - fbm(p + vec2(dot(sunEN, wTo), dot(sunEN, wAcross)) * 0.22)) * 4.0, -1.0, 1.0);
        cloudCol *= 1.0 + cumulus * sunUp * relief * (relief > 0.0 ? 0.12 : 0.24);
      }
      // Broken low cloud catches warm light on its undersides while the Sun is low but up.
      cloudCol = mix(cloudCol, cloudCol * warm, lowSun * sunUp * 0.7 * (1.0 - thickness));
      cloudCol = mix(cloudCol, cloudCol * u_tint, 0.35 * (1.0 - thickness) * sunUp);
      cloudCol = mix(shade * 0.45, cloudCol, sunUp);
      // A closed deck is brightest overhead: the CIE standard overcast sky's luminance goes as
      // 1 + 2 sin(elevation), a third at the horizon of what it is at the zenith. Normalised to a
      // view 15 deg up (where the deck was drawn before) and held within 0.65-1.45, it comes in
      // as the low deck closes.
      float sinView = clamp(dot(rayEC, u_eyeUpEC), 0.0, 1.0);
      float cie = clamp((1.0 + 2.0 * sinView) / 1.52, 0.65, 1.45);
      cloudCol *= mix(1.0, cie, smoothstep(0.6, 0.95, covLow));
      // Broken cloud against the Sun: lit from behind, its cores go dark - the light has to get
      // through them - within about 15 deg of the Sun - while its thin margins scatter the
      // light forward and glow (the silver lining, gold at a low Sun), within about 8 deg and
      // strongest beside it (a wider glow blew a broad white blot round a Sun behind cloud); an
      // overcast has no margins to light.
      {
        float aSun = acos(clamp(dot(rayEC, u_sunDirEC), -1.0, 1.0));
        float broken = sunUp * (1.0 - smoothstep(0.6, 0.95, covLow)) * detail;
        float back = exp(-aSun / 0.26) * broken;
        float rim = exp(-aSun / 0.14) * broken;
        // The margin by the deck's own soft edge, whatever the cumulus's firmer one: a lining
        // is a glow along the rim, not a line drawn round it.
        float soft = smoothstep(1.0 - covLow - 0.15, 1.0 - covLow + 0.15, n);
        float margin = 4.0 * soft * (1.0 - soft);
        float core = smoothstep(0.35, 0.8, cloud);
        cloudCol *= 1.0 - 0.45 * back * core * (0.5 + 0.5 * thickness);
        cloudCol += mix(vec3(1.0), warm, lowSun) * 0.9 * rim * margin;
      }
      cloudCol *= deckLum * mix(1.0, 0.15, u_nightFactor * (1.0 - sunUp));
      sky = mix(sky, cloudCol, cloud * (0.75 + 0.25 * thickness));
      lowHere = cloud * thickness;
    }
    // Rain shafts: while it rains, the rain falling from the low deck hangs toward the horizon
    // as grey curtains - distinct shafts under broken shower cloud, a near-continuous veil under
    // an overcast - darkest at the horizon and fading up to about 8 deg, streaked down their
    // length, drifting with the wind round the horizon. In the low deck's grey, darkened by the
    // rain's own depth.
    if (u_precipitation > 0.02 && covLow > 0.05) {
      float sinUp = dot(rayEC, u_eyeUpEC);
      if (sinUp > -0.02 && sinUp < 0.16) {
        vec3 northEC = cross(u_eyeUpEC, u_eyeEastEC);
        float az = atan(dot(rayEC, u_eyeEastEC), dot(rayEC, northEC));
        float drift = mod(u_time, 5760.0) * u_windMps * 0.0004;
        float curtains = vnoise(vec2(az * 9.0 + drift, 3.7)) * 0.65 + vnoise(vec2(az * 23.0 - drift, 8.1)) * 0.35;
        float showery = 1.0 - smoothstep(0.6, 0.95, covLow);
        float shaft = smoothstep(mix(0.2, 0.55, showery), mix(0.35, 0.7, showery), curtains);
        float streaks = 0.75 + 0.25 * vnoise(vec2(az * 260.0, sinUp * 6.0));
        float height = 1.0 - smoothstep(0.0, 0.14, sinUp);
        float rain = smoothstep(0.02, 0.25, u_precipitation) * (0.35 + 0.45 * covLow);
        vec3 rainCol = vec3(0.42, 0.44, 0.48) * deckLum * mix(1.0, 0.15, u_nightFactor);
        sky = mix(sky, rainCol, clamp(shaft * streaks * height * rain, 0.0, 0.8));
      }
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
    // The towns' glow at night (sky-glow.ts: Walker's law over the mapped built-up areas, set
    // by the host): their lights scattered back down by the air, a warm dome low over the towns
    // - a lobe toward the strongest of them, all round where the place is in or by a city, and
    // a little up to the zenith there - lit as the lights come on. A deck over a town is lit
    // from below, so cloud carries more of it: the orange overcast of a city night. Strength 1
    // is a city sky (about 60 times a natural one), its horizon a dull orange-grey.
#ifdef LM_NIGHT
    if (u_townGlow.x * u_townGlow.z > 0.0) {
      vec3 up = u_eyeUpEC;
      float elevR = asin(clamp(dot(rayEC, up), -1.0, 1.0));
      vec3 rayH = rayEC - dot(rayEC, up) * up;
      vec3 dirH = u_townGlowDirEC - dot(u_townGlowDirEC, up) * up;
      float toward = dot(normalize(rayH + 1e-6), normalize(dirH + 1e-6));
      float lobe = pow(0.5 + 0.5 * toward, 3.0);
      float shape = mix(lobe, 1.0, u_townGlow.y);
      float height = exp(-max(elevR, 0.0) / 0.16) + 0.2 * u_townGlow.y;
      float decks = 1.0 + 1.5 * clamp(u_cloudOpacity, 0.0, 1.0);
      color += vec3(1.0, 0.72, 0.45) * 0.2 * u_townGlow.x * u_townGlow.z * shape * height * decks;
    }
#endif
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
    // Haze lives near the ground: its density falls with height, an exponential layer with a
    // 1.2 km scale height, at the visibility's own density at the place's ground (where a
    // forecast measures it). The optical depth is the density averaged along the ray, from the
    // eye's height to the point's: a camera looking down from above sees through thin air into
    // the haze; from a summit a far peak stands clear in the summit's thinner air while the
    // valley below sinks into its haze (held to 2.5 times the place's own).
    float visibilityM = 4000.0 * pow(20.0, 1.0 - clamp(u_haze, 0.0, 1.0))
        / (1.0 + 2.0 * max(0.0, u_horizonHaze - u_haze));
    float dh = -dot(rayEC, u_eyeUpEC) * distM;   // how far the path descends, metres
    // Not clamped above: from orbit exp(-h0/H) is ~0 and the average comes out thin, as it is.
    float h0 = max(u_eyeHeightM - u_hazeBaseM, -1100.0);
    float h1 = max(h0 - dh, -1100.0);
    float rho0 = exp(-h0 / 1200.0);
    float layer = abs(h0 - h1) < 1.0 ? rho0
        : 1200.0 * (exp(-h1 / 1200.0) - rho0) / (h0 - h1);
    layer = min(layer, 2.5);
    // The air's own molecules scatter too, and by colour: Rayleigh's coefficients at sea level,
    // 5.8 / 13.5 / 33.1 per 1000 km for red, green and blue, in an 8 km scale-height layer. The
    // visibility is measured in green, so green's share of it is the molecules' and the rest
    // the haze's (grey); red then fades into the air more slowly than the visibility says and
    // blue faster, so a ridge 10-40 km off on a clear day goes blue before it goes pale - the
    // blue of far hills - while a hazy day's is the haze's grey as before.
    vec3 rayleigh = vec3(5.8e-6, 13.5e-6, 33.1e-6);
    float rho0R = exp(-h0 / 8000.0);
    float layerR = abs(h0 - h1) < 1.0 ? rho0R
        : 8000.0 * (exp(-h1 / 8000.0) - rho0R) / (h0 - h1);
    layerR = min(layerR, 1.15);
    float mieBeta = max(3.0 / visibilityM - rayleigh.g, 0.0);
    vec3 distRGB = 1.0 - exp(-distM * (mieBeta * layer + rayleigh * layerR));
    float dist = distRGB.g;
    // Distant ground fades toward the sky at the horizon behind it: the sky gradient's own
    // horizon colour (cloud greys it, night darkens it, haze pales it), the glow's colour on
    // the Sun's side at a low Sun and the plain horizon away from it, by the ray's bearing.
    vec3 rayH = rayEC - u_eyeUpEC * dot(rayEC, u_eyeUpEC);
    vec3 sunH = u_sunDirEC - u_eyeUpEC * dot(u_sunDirEC, u_eyeUpEC);
    float towardSun = dot(rayH, sunH) / max(length(rayH) * length(sunH), 1e-4);
    float glowSide = clamp(0.5 + 0.5 * towardSun, 0.0, 1.0);
    glowSide *= glowSide;
    vec3 hazeCol = mix(u_hazeAway, u_hazeToward, glowSide);
    // The gradient's twilight and night stops are colours for the chrome, not the dome as the
    // grade darkens it: through the dusk the haze goes to the night air's dark blue as the dome
    // does, so a far ridge never stands lighter than the sky over it. The dome comes out near
    // black at night (its faint glow cut to 6 %), so the night air is near black too: at 0.05
    // to 0.1 the far sea stood as a lit navy band under a black sky.
    hazeCol = mix(hazeCol, vec3(0.012, 0.016, 0.03), u_nightFactor);
    // Over dry country the haze is dust, not droplets: its share of the extinction (the part
    // that is not the molecules') takes a tan cast at the light's brightness - the beige
    // distance of a desert or a dry summer's plain - while the molecules' blue stays blue.
    if (u_dust > 0.0) {
      float mieShare = mieBeta * layer / max(mieBeta * layer + rayleigh.g * layerR, 1e-9);
      float lum = dot(hazeCol, vec3(0.2126, 0.7152, 0.0722));
      vec3 dustCol = vec3(1.12, 0.98, 0.78) * lum;
      hazeCol = mix(hazeCol, dustCol, 0.6 * clamp(u_dust, 0.0, 1.0) * mieShare);
    }
    color = mix(color, hazeCol, clamp(distRGB * 0.85, 0.0, 0.85));
    // Valley mist: on a calm, near-saturated morning the air cooled on the ground overnight lies
    // in the low ground as a shallow white layer - full below the low ground about the place
    // (u_mistFloorM: the lowest of the terrain's samples a few km round), thinning above it with
    // a 70 m scale height, a 1.5 km visibility at its full - until the Sun burns it off. The density averaged along the ray as for the haze (the integral of
    // min(1, exp(-h / H)) is h below the ground and H (1 - exp(-h / H)) above it), so from a
    // summit the plain and valleys below are drowned in white while the ridges stand out of it,
    // and from within it the distance goes white. Its light is the sky's at the horizon, paled
    // toward white (droplets scatter all colours alike) and warmed a little on the Sun's side.
    if (u_mist > 0.0) {
      float f0 = max(u_eyeHeightM - u_mistFloorM, -1100.0);
      float f1 = max(f0 - dh, -1100.0);
      float m0 = f0 <= 0.0 ? f0 : 70.0 * (1.0 - exp(-f0 / 70.0));
      float m1 = f1 <= 0.0 ? f1 : 70.0 * (1.0 - exp(-f1 / 70.0));
      float mAvg = abs(f0 - f1) < 1.0 ? min(1.0, exp(-f0 / 70.0)) : (m0 - m1) / (f0 - f1);
      float mist = 1.0 - exp(-3.0 * distM * clamp(mAvg, 0.0, 1.0) * u_mist / 1500.0);
      vec3 mistCol = mix(vec3(dot(hazeCol, vec3(0.2126, 0.7152, 0.0722))), hazeCol, 0.6);
      mistCol *= 1.05 + 0.15 * glowSide;
      color = mix(color, mistCol, clamp(mist, 0.0, 0.92));
    }
  }

  // Sunbeams: with a low Sun hidden behind a ridge, buildings or trees, the hazy air between is
  // lit in lanes where its line to the Sun is open and left in the shade's lanes where it is
  // not - the rays a photographer waits for. Marched in screen space toward the Sun (16 depth
  // reads over at most 0.6 of the screen's height): the share of the way that is open sky
  // lights the pixel, falling off away from the Sun, and only as much as the Sun's own disc is
  // hidden (an open Sun is its glare's, not rays'). Its own variant of the grade (LM_RAYS), so
  // the march costs nothing when no low Sun is ahead.
#ifdef LM_RAYS
  if (u_rays > 0.0 && u_sunDirEC.z < 0.0) {
    vec4 sc = czm_projection * vec4(u_sunDirEC * 1000.0, 1.0);
    vec2 sunUv = sc.xy / sc.w * 0.5 + 0.5;
    vec2 toSun = sunUv - v_textureCoordinates;
    float lenS = length(toSun * czm_viewport.zw) / czm_viewport.w;
    vec2 stepUv = toSun * min(1.0, 0.6 / max(lenS, 1e-4)) / 16.0;
    vec2 pr = v_textureCoordinates;
    float open = 0.0;
    for (int i = 0; i < 16; i++) {
      pr += stepUv;
      open += step(1.0 - 1e-6, texture(depthTexture, pr).r);
    }
    open /= 16.0;
    vec2 px = 3.0 / czm_viewport.zw;
    float sunOpen = 0.2 * (step(1.0 - 1e-6, texture(depthTexture, sunUv).r)
        + step(1.0 - 1e-6, texture(depthTexture, sunUv + vec2(px.x, 0.0)).r)
        + step(1.0 - 1e-6, texture(depthTexture, sunUv - vec2(px.x, 0.0)).r)
        + step(1.0 - 1e-6, texture(depthTexture, sunUv + vec2(0.0, px.y)).r)
        + step(1.0 - 1e-6, texture(depthTexture, sunUv - vec2(0.0, px.y)).r));
    bool sunOnScreen = all(greaterThan(sunUv, vec2(0.0))) && all(lessThan(sunUv, vec2(1.0)));
    float hidden = sunOnScreen ? 1.0 - sunOpen : 0.5;
    color += u_sunTint * open * exp(-lenS / 0.35) * hidden * u_rays * 0.22;
  }
#endif

  // The rainbow: sunlight turned back by the falling drops, round the point opposite the Sun -
  // the primary bow from 40.6 deg (violet, inside) to 42.3 (red, outside), the fainter
  // secondary from 50.4 (red, inside) to 53.4 (violet, outside), the sky brighter inside the
  // primary and darker between the two (Alexander's band). Its colours washed by the Sun's
  // half-degree disc. Over the sky (where a shower's curtain stands against it), opposite a
  // Sun under 42 deg.
  if (isSky && u_rainbow > 0.0) {
    float th = degrees(acos(clamp(-dot(rayEC, u_sunDirEC), -1.0, 1.0)));
    float t1 = (th - 40.4) / 2.1;
    float b1 = smoothstep(-0.12, 0.12, t1) * (1.0 - smoothstep(0.88, 1.12, t1));
    float t2 = (53.6 - th) / 3.2;
    float b2 = smoothstep(-0.12, 0.12, t2) * (1.0 - smoothstep(0.88, 1.12, t2));
    vec3 h1 = clamp(abs(mod((1.0 - clamp(t1, 0.0, 1.0)) * 0.78 * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    vec3 h2 = clamp(abs(mod((1.0 - clamp(t2, 0.0, 1.0)) * 0.78 * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    vec3 bow = mix(h1, vec3(1.0), 0.3) * b1 * 0.16 + mix(h2, vec3(1.0), 0.4) * b2 * 0.06;
    float inside = 1.0 - smoothstep(39.5, 40.8, th);
    float alexander = smoothstep(42.4, 43.4, th) * (1.0 - smoothstep(49.6, 50.6, th));
    color = color * (1.0 + u_rainbow * (0.07 * inside - 0.06 * alexander)) + bow * u_rainbow;
  }

  // Global grade.
  color = saturate3(color, u_saturation);
  color = (color - 0.5) * u_contrast + 0.5;
  // Colour temperature tint of the whole frame, strongest in direct light, weak in overcast.
  float tintAmount = mix(0.35, 0.12, u_cloudOpacity);
  color *= mix(vec3(1.0), u_tint, tintAmount);

  // Rain streaks (the liquid share of what falls).
  float rainFall = max(u_precipitation - u_snowfall, 0.0);
  if (rainFall > 0.01) {
    vec2 r = v_textureCoordinates * vec2(220.0, 18.0) + vec2(0.0, -u_time * 3.0);
    float streak = smoothstep(0.93, 1.0, vnoise(r)) * smoothstep(0.6, 1.0, vnoise(r * 0.37 + 11.0));
    color = mix(color, color * 0.8 + vec3(0.18), streak * rainFall * 0.8);
  }
  // Snowfall: flakes, not streaks - soft pale specks at three depths, the near ones few and
  // large, the far ones a fine dust, a little taller than wide (they fall while the shutter is
  // open), re-dealt as the clock moves. As pale as the snow-laden sky that lights them, so they
  // show against anything darker and are lost against the sky itself; dim grey by night.
  if (u_snowfall > 0.01) {
    vec2 suv = vec2(v_textureCoordinates.x * czm_viewport.z / max(czm_viewport.w, 1.0), v_textureCoordinates.y);
    float fall = mod(u_time, 5760.0);
    float flakes = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      vec2 q = suv * 15.0 * pow(2.1, fk) + vec2(fk * 19.7, fall * 2.3 / (1.0 + fk) + fk * 7.1);
      vec2 cell = floor(q);
      vec2 f = fract(q);
      vec2 c = 0.25 + 0.5 * vec2(hash(cell + 3.1), hash(cell + 7.3));
      float r = mix(0.07, 0.2, hash(cell + 11.9));
      float present = step(1.0 - (0.07 + 0.3 * u_snowfall), hash(cell));
      vec2 d = (f - c) * vec2(1.0, 0.6);
      flakes += present * (1.0 - smoothstep(r * 0.3, r, length(d)))
              * (0.5 + 0.5 * hash(cell + 17.3)) * (0.95 - 0.2 * fk);
    }
    vec3 flakeCol = vec3(0.93, 0.95, 0.98) * mix(1.0, u_skyLuminance, 0.6) * mix(1.0, 0.18, u_nightFactor);
    color = mix(color, max(color, flakeCol), clamp(flakes, 0.0, 1.0) * 0.8);
  }

  // No green sky: Cesium's single-scattering dome runs a low Sun's pale horizon to a mint
  // green (measured round a golden-hour glow: green 30-45 levels over both red and blue), a hue
  // a clear sky does not take - its colours run from blue through white to yellow and orange.
  // Green is held to a hair over the larger of the other two, last (held on the dome, the
  // grade's contrast clipped green first on the glow's near-white rim and brought it back).
  if (isSky) {
    color = clamp(color, 0.0, 1.0);
    color.g = mix(color.g, min(color.g, max(color.r, color.b) + 0.01), 0.9);
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

/** The day grade with sunbeams (LM_RAYS), drawn while a low Sun is ahead of the camera. */
export const GRADE_RAYS_FRAGMENT_SHADER = `#define LM_RAYS\n${GRADE_SOURCE}`;

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
  'u_snowfall',
  'u_rainbow',
  'u_rays',
  'u_mist',
  'u_mistFloorM',
  'u_horizonHaze',
  'u_sunElevation',
  'u_time',
  'u_sunScreen',
  'u_sunVisible',
  'u_eyeUpEC',
  'u_eyeEastEC',
  'u_windToward',
  'u_eyeFromPlaceKm',
  'u_windMps',
  'u_lowDeckKm',
  'u_dust',
  'u_eyeHeightM',
  'u_starField',
  'u_atmosphereDark',
  'u_hazeAway',
  'u_hazeToward',
  'u_hazeBaseM',
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
  'u_townGlow',
  'u_townGlowDirEC',
] as const;

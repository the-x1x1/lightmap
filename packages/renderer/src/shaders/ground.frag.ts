/**
 * Ground texture: a procedural surface for the terrain preview (Phase 4 "improved terrain
 * texture"), so the mesh reads as ground — turf and scrub on the lower slopes, bare rock where
 * it is steep, scree and alpine ground above the treeline, snow above a snowline that follows
 * the latitude and the season and lies lower on poleward faces, a strip of shore where flat
 * ground meets sea level — instead of a grey plane under a 40 km-per-pixel basemap.
 *
 * It is a Cesium globe material (`globe.material`): the fragment runs before the globe's own
 * lighting and shadows, so the Sun's direction, the terrain shadows and the horizon geometry are
 * untouched (plan §1E) — only the surface albedo changes. Its inputs are the terrain's own
 * height, slope and aspect (per vertex, from the mesh normals) and a value-noise field over the
 * fragment's world position, so patches are fixed to the ground and do not swim as the camera
 * moves (float ECEF jitter is ~0.5 m; the finest world-anchored octave is 8 m; the detail tiles
 * nearer the camera are computed camera-relative along a ground-anchored frame, in three tiers
 * that each fade in by their size on screen). The colour is blended
 * over the basemap with an alpha that rises on rock and snow and falls on open ground, so a
 * real imagery layer, where one is licensed, still shows through where it matters — vegetation
 * hue, desert, farmland — and the procedural surface supplies the detail the basemap lacks.
 *
 * The one regional cue it always takes is the bundled basemap's own colour around the place
 * (sampled once per place by the host): green leans the open ground to turf, tan to steppe and
 * desert, white to an ice sheet. With a land-cover tile source configured (texture pack stage
 * 2, `land-cover.ts`) it also samples a **cover map** around the pin — canopy, built-up, bare
 * ground and ice, cropland — and paints forest, fields, a city, desert and an ice sheet as
 * what they are; where the map is unknown (no tiles, or beyond its reach) the procedural rules
 * stand alone. Still a texture, not a classification of the pixel under the camera:
 * `RENDERING_ACCURACY.md` says so.
 */
export const GROUND_MATERIAL_TYPE = 'LightMapGround';

/** Cell size of the near grain, metres; the host passes the camera's position in these cells. */
export const GROUND_GRAIN_M = 2.5;

/** Uniforms the material takes, with their defaults; `groundTextureFor()` sets them per scene. */
export const GROUND_UNIFORM_DEFAULTS = {
  /** Height above the ellipsoid from which snow lies, metres. */
  u_snowlineM: 3000,
  /** Height above which the cover thins to alpine ground and scree, metres (does not move with the season). */
  u_treelineM: 2100,
  /** +1 in the northern hemisphere (north-facing slopes hold snow), −1 in the southern. */
  u_poleward: 1,
  /** Overall opacity over the basemap, 0–1. */
  u_strength: 1,
  /** The region's aridity from the basemap's colour, 0 vegetated – 1 desert. */
  u_aridity: 0.25,
  /** The region's ice-sheet share from the basemap's colour, 0–1. */
  u_ice: 0,
  /** The chart's brightness (the night map is dimmed), applied to the surface as well. */
  u_brightness: 1,
  /** Ellipsoidal height of sea level at the place, metres (the geoid). */
  u_seaLevelM: 0,
  /** How strongly broken cloud dapples the ground, 0–1. */
  u_cloudShadow: 0,
  /** The planner's clock in minutes (the sky's clouds drift with the same one). */
  u_cloudTime: 0,
  /** How wet the ground is, 0–1 (the scenario's precipitation): wet ground is darker and duller. */
  u_wet: 0,
  /**
   * Detail level from the quality rung: 0 base surface, 1 adds cloud shadows, 2 adds relief and
   * the detail tiles. Continuous: the host eases it between rungs over half a second, so a
   * quality change mid-flight fades the detail rather than switching it.
   */
  u_detail: 2,
  /** 1 when a cover map is loaded and its bounds set; 0 leaves the procedural rules alone. */
  u_coverOn: 0,
  /** 1 when the detail tiles are loaded: the near field takes its grain from them instead of the noise. */
  u_detailOn: 0,
  /**
   * 1 when the basemap is the bundled coarse one (Natural Earth, ~500 m per pixel): the paint
   * then covers the land almost completely, so the basemap's blocky coastline and lakes never
   * show through as water on land; 0 with real imagery, which shows through where it matters.
   */
  u_coarseBasemap: 1,
} as const;

/**
 * The detail tiles (texture pack stage 3): four wrapping 256 px textures, one per surface, each
 * its own sampler so it carries a full mip chain and the GPU's own REPEAT wrap — an atlas's
 * quadrants bleed into each other at every mip level below the first, which showed as the
 * near field going grey and then popping as the camera pulled back.
 */
export const GROUND_DETAIL_IMAGE_UNIFORMS = {
  grass: 'u_detailGrass',
  rock: 'u_detailRock',
  sand: 'u_detailSand',
  snow: 'u_detailSnow',
} as const;
/** The bundled atlas's quadrants, in the order the generator writes them (NW, NE, SW, SE). */
export const GROUND_DETAIL_QUADRANTS = ['grass', 'rock', 'sand', 'snow'] as const;
/** Ground period of one detail tile, metres (the finest tier). */
export const GROUND_DETAIL_PERIOD_M = 2.5;
/**
 * The detail tiles' two periods and the offset uniform each takes: the camera's own position
 * along the frame in that period (the fraction, from the CPU in double). Each needs its own — a
 * second scale derived by scaling the first's coordinate would jump every time the camera
 * crossed a period, since only the fraction reaches the shader. The ratio (2.68) is far from a
 * whole number, so the two repeats never line up into a grid.
 */
export const GROUND_DETAIL_TIERS = [
  { periodM: 2.5, offsetUniform: 'u_detailOffset' },
  { periodM: 6.7, offsetUniform: 'u_detailOffset1' },
] as const;

/**
 * The mottling between the macro patches and the tiles: value noise over the ground at these
 * cell sizes, which never repeats (a tile shrunk to a few pixels repeats into a visible grid).
 * Each takes the camera's position along the ground frame in its own cells — the whole cells
 * and the fraction, from the CPU in double — so it is fixed to the ground and precise.
 */
export const GROUND_MOTTLE_SCALES = [
  { cellM: 3, cellUniform: 'u_mottleCell0', fracUniform: 'u_mottleFrac0' },
  { cellM: 12, cellUniform: 'u_mottleCell1', fracUniform: 'u_mottleFrac1' },
  { cellM: 48, cellUniform: 'u_mottleCell2', fracUniform: 'u_mottleFrac2' },
] as const;

/** The cover map's sampler uniform (an image uniform in Cesium's material fabric: a canvas, or `Material.DefaultImageId`). */
export const GROUND_COVER_IMAGE_UNIFORM = 'u_coverMap';
/** The cover map's bounds uniform, a vec4 (Cartesian4): longitude in radians (west, east), mercator y (north, south). */
export const GROUND_COVER_BOUNDS_UNIFORM = 'u_coverBounds';

export const GROUND_MATERIAL_SOURCE = /* glsl */ `
uniform float u_snowlineM;
uniform float u_treelineM;
uniform float u_poleward;
uniform float u_strength;
uniform float u_aridity;
uniform float u_ice;
uniform float u_brightness;
uniform float u_seaLevelM;
uniform float u_cloudShadow;
uniform float u_cloudTime;
uniform float u_detail;
uniform float u_wet;
uniform float u_coverOn;
uniform vec4 u_coverBounds;
uniform sampler2D u_coverMap;
uniform float u_detailOn;
uniform float u_coarseBasemap;
uniform sampler2D u_detailGrass;
uniform sampler2D u_detailRock;
uniform sampler2D u_detailSand;
uniform sampler2D u_detailSnow;
// The camera's east/north/up axes in world (ECEF) coordinates, and its own position along them
// in detail periods (the fraction), set each frame so the atlas is anchored to the ground.
uniform vec3 u_eastWC;
uniform vec3 u_northWC;
uniform vec3 u_upWC;
uniform vec3 u_detailOffset;
uniform vec3 u_detailOffset1;
uniform vec3 u_mottleCell0;
uniform vec3 u_mottleFrac0;
uniform vec3 u_mottleCell1;
uniform vec3 u_mottleFrac1;
uniform vec3 u_mottleCell2;
uniform vec3 u_mottleFrac2;
// The camera's position in grain cells: whole cells and the fraction, set each frame.
uniform vec3 u_cameraCell;
uniform vec3 u_cameraFrac;

// Hash without axis correlation (Hoskins' hash13), so the noise has no lattice pattern.
float lmHash(vec3 p)
{
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

float lmNoise(vec3 x)
{
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(lmHash(i), lmHash(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(lmHash(i + vec3(0.0, 1.0, 0.0)), lmHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(lmHash(i + vec3(0.0, 0.0, 1.0)), lmHash(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(lmHash(i + vec3(0.0, 1.0, 1.0)), lmHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
}

// Value noise with the lattice offset by whole cells, for coordinates kept small for precision.
float lmNoiseAt(vec3 x, vec3 cell)
{
    vec3 i = floor(x) + cell;
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(lmHash(i), lmHash(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(lmHash(i + vec3(0.0, 1.0, 0.0)), lmHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(lmHash(i + vec3(0.0, 0.0, 1.0)), lmHash(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(lmHash(i + vec3(0.0, 1.0, 1.0)), lmHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
}

// Four octaves, 0..~0.94, mean ≈ 0.47.
float lmFbm(vec3 p)
{
    return 0.5 * lmNoise(p) + 0.25 * lmNoise(p * 2.03 + 11.0) + 0.125 * lmNoise(p * 4.07 + 23.0) + 0.0625 * lmNoise(p * 8.11 + 37.0);
}

// Geodetic longitude/latitude of an ECEF position (WGS84; one Bowring step, < 1e-6 rad), then
// the cover map's texel: x by longitude, y by mercator latitude, as the tiles are laid out.
vec2 lmCoverUv(vec3 p)
{
    float a = 6378137.0;
    float e2 = 0.00669437999014;
    float lon = atan(p.y, p.x);
    float r = length(p.xy);
    float lat0 = atan(p.z, r * (1.0 - e2));
    float sinL = sin(lat0);
    float N = a / sqrt(1.0 - e2 * sinL * sinL);
    float lat = atan(p.z + e2 * N * sinL, r);
    float merc = log(tan(0.78539816 + 0.5 * lat));
    // A mosaic across the antimeridian has its west edge below -pi; bring the longitude into it.
    if (lon < u_coverBounds.x - 3.14159265) lon += 6.28318531;
    // Images are uploaded bottom-up (flipY): the canvas's first row, the north edge, is t = 1.
    return vec2((lon - u_coverBounds.x) / (u_coverBounds.y - u_coverBounds.x),
                (merc - u_coverBounds.w) / (u_coverBounds.z - u_coverBounds.w));
}

// Value noise on an integer lattice given as whole cells (large: a camera's position in
// metre-scale cells runs to millions) plus a small local coordinate. The hash works on the
// integers themselves (PCG), so it stays random however large they are.
#if __VERSION__ >= 300
float lmHashI(vec3 c)
{
    uvec3 v = uvec3(ivec3(c) + ivec3(1 << 24));
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return float(v.x & 0xffffffu) / 16777216.0;
}
#else
float lmHashI(vec3 c) { return lmHash(mod(c, 4096.0)); }
#endif

float lmNoiseI(vec3 local, vec3 cell)
{
    vec3 fl = floor(local);
    vec3 i = fl + cell;
    vec3 f = local - fl;
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(lmHashI(i), lmHashI(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(lmHashI(i + vec3(0.0, 1.0, 0.0)), lmHashI(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(lmHashI(i + vec3(0.0, 0.0, 1.0)), lmHashI(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(lmHashI(i + vec3(0.0, 1.0, 1.0)), lmHashI(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
}

// One wrapping tile (t: 0 grass, 1 rock, 2 sand, 3 snow) at an unwrapped coordinate in tile
// periods; the sampler wraps and chooses the mip level from the derivatives the caller took
// outside any branch. The tiles are normalised to a mean of 0.5, so a minified sample tends to
// 0.5 and the multiplier below to 1: at a distance the tile fades out by itself, with no seam.
vec3 lmDetail(vec2 uv, vec2 duvdx, vec2 duvdy, float t)
{
#if __VERSION__ >= 300
    if (t < 0.5) return textureGrad(u_detailGrass, uv, duvdx, duvdy).rgb;
    if (t < 1.5) return textureGrad(u_detailRock, uv, duvdx, duvdy).rgb;
    if (t < 2.5) return textureGrad(u_detailSand, uv, duvdx, duvdy).rgb;
    return textureGrad(u_detailSnow, uv, duvdx, duvdy).rgb;
#else
    if (t < 0.5) return texture(u_detailGrass, uv).rgb;
    if (t < 1.5) return texture(u_detailRock, uv).rgb;
    if (t < 2.5) return texture(u_detailSand, uv).rgb;
    return texture(u_detailSnow, uv).rgb;
#endif
}

// The tile across the three projections of a point and its normal weights.
vec3 lmDetailTri(vec3 q, vec3 dqx, vec3 dqy, vec3 w, float tile)
{
    return lmDetail(q.yz, dqx.yz, dqy.yz, tile) * w.x
         + lmDetail(q.xz, dqx.xz, dqy.xz, tile) * w.y
         + lmDetail(q.xy, dqx.xy, dqy.xy, tile) * w.z;
}

// One scale of the detail: the two tiles blended, as a multiplier about 1, weighted by how many
// screen pixels one period spans (from the coordinate's own derivatives): gone below 40 px per
// period (shrunk further, a tile's repeat reads as a grid of dots), full from 160 px, so it
// fades in smoothly as the camera closes and never pops.
vec3 lmDetailTier(vec3 q, vec3 dqx, vec3 dqy, vec3 w, float t1, float t2, float blend, float amount)
{
    float pxPerPeriod = 1.0 / max(max(length(dqx), length(dqy)), 1e-6);
    float tierW = smoothstep(40.0, 160.0, pxPerPeriod) * amount;
    if (tierW <= 0.001) return vec3(1.0);
    vec3 d = lmDetailTri(q, dqx, dqy, w, t1);
    if (blend > 0.02) d = mix(d, lmDetailTri(q, dqx, dqy, w, t2), blend);
    // Mostly the tile's light and shade, little of its hue: the macro rules already chose the
    // colour, and the full tile hue on top (a lime grass over green turf) went cartoonish.
    d = mix(vec3(dot(d, vec3(0.3, 0.59, 0.11))), d, 0.3);
    return mix(vec3(1.0), d * 2.0, tierW);
}

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);
    // World position of the fragment (ECEF, metres) anchors the noise to the ground.
    vec3 positionEC = -materialInput.positionToEyeEC;
    vec3 positionWC = (czm_inverseView * vec4(positionEC, 1.0)).xyz;
    float patches = lmFbm(positionWC / 480.0);          // broad patchiness, ~500 m
    float grain = lmFbm(positionWC / 60.0 + 5.0);     // fine detail, 60 m down to ~8 m
    float slope = materialInput.slope;                // radians, 0 flat
    float height = materialInput.height - u_seaLevelM; // metres above sea level

    // Open ground leans from turf and scrub toward steppe and desert with the region's aridity —
    // and, on a slope, with which way it faces: the equatorward face takes the noon Sun and
    // dries to scrub, the poleward face stays greener (a rule of the mid-latitudes; flat ground
    // and the tropics barely move). Computed before the snow uses the same facing below.
    // Which way the slope faces, from the fragment's own normal (the interpolated aspect angle
    // wraps at east and would sweep through every value inside a triangle there): the
    // horizontal part of the normal against local north, +1 facing the pole.
    vec3 nW = czm_inverseViewRotation * materialInput.normalEC;
    vec3 upW = normalize(positionWC);
    vec3 eastW = normalize(cross(vec3(0.0, 0.0, 1.0), upW));
    vec3 northW = cross(upW, eastW);
    vec3 nH = nW - upW * dot(nW, upW);
    float northness = dot(nH, northW) / max(length(nH), 1e-4);
    float facing = slope > 0.05 ? northness * u_poleward * smoothstep(0.05, 0.4, slope) : 0.0;  // +1 facing the pole
    float dryness = clamp(u_aridity - 0.18 * facing, 0.0, 1.0);
    vec3 turf  = mix(vec3(0.34, 0.43, 0.22), vec3(0.62, 0.55, 0.36), dryness);
    vec3 scrub = mix(vec3(0.52, 0.46, 0.27), vec3(0.74, 0.64, 0.44), dryness);
    vec3 rock  = vec3(0.52, 0.49, 0.45);
    vec3 scree = vec3(0.40, 0.38, 0.34);
    vec3 snow  = vec3(0.93, 0.95, 0.97);
    vec3 shore = vec3(0.74, 0.69, 0.55);

    // Open ground: turf and scrub in patches, grained.
    vec3 ground = mix(turf, scrub, smoothstep(0.32, 0.62, patches - 0.08 * facing));
    ground *= 0.82 + 0.36 * grain;

    // Above the treeline the cover thins to alpine ground and scree.
    float alpine = smoothstep(u_treelineM - 400.0, u_treelineM + 300.0, height + 200.0 * (patches - 0.47));
    vec3 bare = mix(scree, rock, grain) * (0.84 + 0.32 * patches);
    ground = mix(ground, bare, alpine);

    // Steep faces are bare rock, from about 30° to 45°, broken up by the grain.
    float rocky = smoothstep(0.52, 0.78, slope + 0.12 * (grain - 0.47));
    ground = mix(ground, bare, rocky);

    // Flat ground within a few metres of sea level reads as shore.
    float shoreline = smoothstep(14.0, 3.0, height) * smoothstep(0.10, 0.02, slope);
    ground = mix(ground, shore * (0.9 + 0.2 * grain), shoreline);

    // Snow above the snowline: lower on poleward faces, patchy at its edge, thin on cliffs.
    // (The aspect of a perfectly flat vertex is undefined; flat ground has no poleward face.)
    float poleward = facing;
    float snowline = u_snowlineM - 180.0 * poleward + 320.0 * (patches - 0.47);
    float snowy = smoothstep(snowline - 220.0, snowline + 160.0, height) * (1.0 - smoothstep(0.85, 1.15, slope));
    snowy = max(snowy, u_ice * (1.0 - smoothstep(0.9, 1.2, slope)));  // an ice sheet is snow at any height
    ground = mix(ground, snow * (0.95 + 0.05 * grain), snowy);

    // The land cover, where a map is loaded and this fragment lies inside it: what the open
    // ground is. Canopy darkens and greens it with a crown-sized grain; fields are a patchwork
    // of tones in cells a few hundred metres across; built-up ground is warm grey with a
    // block-sized grain; bare is sand and rock by the region's aridity; ice is snow at any
    // height. Rock on steep faces and the seasonal snow still win; unknown texels change nothing.
    float known = 0.0;
    float canopy = 0.0;
    float built = 0.0;
    float bareC = 0.0;
    if (u_coverOn > 0.5)
    {
        vec2 cuv = lmCoverUv(positionWC);
        if (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0)
        {
            vec4 cv = texture(u_coverMap, cuv);
            // Known texels are opaque (so the canvas's premultiplied alpha costs nothing);
            // B carries crop (1/3), bare (2/3) and ice (1) as levels.
            known = step(0.5, cv.a);
            canopy = cv.r;
            built = cv.g;
            float crop = smoothstep(0.17, 0.3, cv.b) * (1.0 - smoothstep(0.42, 0.55, cv.b));
            bareC = smoothstep(0.55, 0.64, cv.b) * (1.0 - smoothstep(0.86, 0.95, cv.b));
            float iceC = smoothstep(0.86, 0.95, cv.b);
            float open = known * (1.0 - snowy) * (1.0 - rocky * 0.7);
            vec3 forest = vec3(0.0);
            if (canopy > 0.0)
            {
                float crowns = lmFbm(positionWC / 45.0 + 3.0);
                forest = mix(vec3(0.13, 0.25, 0.10), vec3(0.27, 0.38, 0.17), crowns) * (0.9 + 0.2 * grain);
            }
            vec3 cell = floor(positionWC / 260.0);
            float fieldTone = lmHash(cell + 7.0);
            vec3 field = mix(vec3(0.50, 0.52, 0.28), vec3(0.72, 0.64, 0.40), fieldTone) * (0.9 + 0.2 * grain);
            float block = lmHash(floor(positionWC / 24.0) + 11.0);
            vec3 town = mix(vec3(0.46, 0.44, 0.42), vec3(0.58, 0.54, 0.50), block) * (0.9 + 0.15 * grain);
            vec3 sand = mix(vec3(0.60, 0.56, 0.48), vec3(0.76, 0.66, 0.46), u_aridity) * (0.86 + 0.28 * grain);
            ground = mix(ground, sand, open * bareC);
            ground = mix(ground, field, open * crop);
            ground = mix(ground, forest, open * canopy);
            ground = mix(ground, town, open * built);
            float icy = iceC * (1.0 - smoothstep(0.9, 1.2, slope));
            ground = mix(ground, snow * (0.95 + 0.05 * grain), icy);
            snowy = max(snowy, icy);
        }
    }

    // Nearer the camera, the detail tiles at two scales (2.5 m and 6.7 m periods), each fading
    // in by its size on screen, below a mottling that carries the zooms in between — so there
    // is texture at every zoom and no scale ever pops in. Anchored to the
    // ground, not the camera: the camera-relative position (precise) along an east/north/up
    // frame the host anchors to the ground (re-anchored only when the camera has moved
    // kilometres), plus the camera's own offset along that frame in tile periods — so the
    // pattern stays put as the camera moves. Derivatives are taken here, outside any branch,
    // as GLSL requires.
    float dist = length(positionEC);
    float nearW = clamp(u_detail - 1.0, 0.0, 1.0) * smoothstep(12000.0, 3000.0, dist);
    vec3 local = czm_inverseViewRotation * positionEC;
    vec3 enu = vec3(dot(local, u_eastWC), dot(local, u_northWC), dot(local, u_upWC));
    vec3 q = enu / 2.5 + u_detailOffset;
    vec3 q1 = enu / 6.7 + u_detailOffset1 + 0.37;
    vec3 dqx = dFdx(q);
    vec3 dqy = dFdy(q);
    // Screen pixels per metre of ground here, for the mottling's fade.
    float pxPerM = 1.0 / max(max(length(dqx), length(dqy)) / 2.5, 1e-6);
    if (nearW > 0.0 && u_detailOn > 0.5)
    {
        // The tiles — grass, rock, sand or snow, whichever the rules above made this ground,
        // the two nearest blended across their edge — projected along the three axes and
        // blended by the surface normal (a sharp triplanar, so a face takes one projection).
        // A multiplier about 1 on the colour the macro rules chose; it never changes what the
        // ground is.
        vec3 w = abs(vec3(dot(nW, u_eastWC), dot(nW, u_northWC), dot(nW, u_upWC)));
        w = w * w * w * w;
        w = w * w;
        w /= (w.x + w.y + w.z + 1e-5);
        // Tile weights: snow, then rock on steep or alpine ground (and streets), sand on the
        // shore, bare desert and arid open ground, grass (and the forest floor) for the rest.
        float wSnow = snowy;
        float wRock = (1.0 - snowy) * max(rocky, max(alpine * (1.0 - 0.6 * u_aridity), built));
        float wSand = (1.0 - snowy) * (1.0 - rocky) * max(shoreline, max(bareC, u_aridity * (1.0 - canopy)));
        float wGrass = (1.0 - snowy) * (1.0 - max(wRock, wSand));
        // The two strongest tiles, blended by their weights.
        float t1 = 0.0; float w1 = wGrass;
        float t2 = 1.0; float w2 = wRock;
        if (wSand > w1) { t2 = t1; w2 = w1; t1 = 2.0; w1 = wSand; } else if (wSand > w2) { t2 = 2.0; w2 = wSand; }
        if (wRock > w1 && t1 != 1.0) { t2 = t1; w2 = w1; t1 = 1.0; w1 = wRock; }
        if (wSnow > w1) { t2 = t1; w2 = w1; t1 = 3.0; w1 = wSnow; } else if (wSnow > w2) { t2 = 3.0; w2 = wSnow; }
        float blend = w2 / max(w1 + w2, 1e-4);
        // The same tiles at 6.7 m (shifted, and at a ratio that never lines up) and 2.5 m: two
        // multipliers about 1, the finer a little stronger.
        float k1 = 2.5 / 6.7;
        vec3 d = lmDetailTier(q1, dqx * k1, dqy * k1, w, t1, t2, blend, 0.4 * nearW)
               * lmDetailTier(q, dqx, dqy, w, t1, t2, blend, 0.55 * nearW);
        ground *= d;
    }
    else if (nearW > 0.0)
    {
        float fineW = smoothstep(500.0, 60.0, dist);
        vec3 local = czm_inverseViewRotation * positionEC / 2.5 + u_cameraFrac;
        float fine = lmNoiseAt(local, u_cameraCell) * 0.6 + lmNoiseAt(local * 2.0 + 0.5, u_cameraCell * 2.0) * 0.3;
        ground *= 1.0 + fineW * 0.3 * (fine - 0.45);
    }

    // Mottling between the macro patches and the tiles: world-anchored value noise at 48 m,
    // 12 m and 3 m cells, never repeating, each fading in as its cells grow past a few pixels
    // on screen (and out again as they shrink, so it never aliases). The broad scale also
    // shifts the hue — drier and yellower in its light patches — as real ground does.
    if (u_detail > 1.0)
    {
        float mW = clamp(u_detail - 1.0, 0.0, 1.0) * (1.0 - 0.6 * snowy);
        float w2 = smoothstep(3.0, 10.0, pxPerM * 48.0);
        float w1 = smoothstep(3.0, 10.0, pxPerM * 12.0);
        float w0 = smoothstep(3.0, 10.0, pxPerM * 3.0);
        float n2 = w2 > 0.0 ? lmNoiseI(enu / 48.0 + u_mottleFrac2, u_mottleCell2) - 0.5 : 0.0;
        float n1 = w1 > 0.0 ? lmNoiseI(enu / 12.0 + u_mottleFrac1, u_mottleCell1) - 0.5 : 0.0;
        float n0 = w0 > 0.0 ? lmNoiseI(enu / 3.0 + u_mottleFrac0, u_mottleCell0) - 0.5 : 0.0;
        ground = mix(ground, ground * vec3(1.08, 1.03, 0.88), clamp(mW * w2 * n2 * 0.9, 0.0, 0.4));
        ground *= 1.0 + mW * (0.26 * w2 * n2 + 0.2 * w1 * n1 + 0.14 * w0 * n0);
    }

    // Micro-relief: the grain read as small bumps, lit by the scene's own Sun direction, so rock
    // and scree show texture that turns with the light through the day. A shading of the albedo
    // only (the mesh, its normals and the shadows are untouched), strongest on bare ground, gone
    // on snow, and fading beyond a few kilometres where it would only shimmer.
    float reliefW = clamp(u_detail - 1.0, 0.0, 1.0)
        * max(rocky, alpine * 0.7) * (1.0 - snowy) * smoothstep(6000.0, 800.0, dist);
    if (reliefW > 0.0)
    {
        // Forward differences from the grain already in hand: two more samples, not four.
        float e = 6.0 / 60.0;
        vec3 pe = positionWC / 60.0 + 5.0;
        float gx = lmFbm(pe + vec3(e, 0.0, 0.0)) - grain;
        float gy = lmFbm(pe + vec3(0.0, e, 0.0)) - grain;
        // The gradient is in world axes; read it as east/north in the surface frame (the
        // difference is a rotation of a random field, which changes nothing a viewer can tell).
        vec3 bumpEC = normalize(materialInput.normalEC + materialInput.tangentToEyeMatrix * vec3(-gx * 2.5, -gy * 2.5, 0.0));
        float flat_ = max(dot(materialInput.normalEC, czm_lightDirectionEC), 0.0);
        float bumped = max(dot(bumpEC, czm_lightDirectionEC), 0.0);
        ground *= clamp(1.0 + reliefW * 0.9 * (bumped - flat_), 0.7, 1.3);
    }

    // Broken cloud: patches of shadow the size of cumulus (a kilometre or two) drifting with the
    // planner's clock, over everything but water. A dappling of the albedo — the direct light's
    // direction, the terrain shadows and the sky are untouched; the patches are a pattern, not
    // the forecast's own clouds.
    if (u_cloudShadow > 0.0 && u_detail > 0.0)
    {
        // The patches move with the planner's clock toward the north-east at ≈ 200 m/min (a
        // 12 km/h wind — a pattern, not the forecast's wind), along the place's own east and
        // north; sampling at position − drift moves the pattern with +drift. They fade toward
        // the horizon, where their finest octave would only shimmer.
        vec3 drift = (eastW * 190.0 + northW * 60.0) * u_cloudTime;
        float cloud = lmFbm((positionWC - drift) / 1400.0 + 13.0);
        float shade = smoothstep(0.38, 0.62, cloud) * smoothstep(80000.0, 15000.0, dist);
        ground *= 1.0 - 0.45 * u_cloudShadow * clamp(u_detail, 0.0, 1.0) * shade;
    }

    // Rain: wet ground is darker and duller (water in the surface), snow apart.
    if (u_wet > 0.0)
    {
        float wetness = u_wet * (1.0 - snowy);
        vec3 grey = vec3(dot(ground, vec3(0.3, 0.59, 0.11)));
        ground = mix(ground, grey, 0.25 * wetness) * (1.0 - 0.3 * wetness);
    }

    material.diffuse = ground * u_brightness;
    // Rock and snow are what they are; open ground lets real imagery's own hue through. Over
    // the bundled coarse basemap the paint is all but opaque on land: that map's 500 m pixels
    // put sea and lakes well onto the land near every coast, and at 25 % through the paint
    // they read as blue blocks on the ground.
    float cover = max(rocky, max(snowy, max(alpine * 0.8, known * 0.9)));
    float alpha = u_strength * mix(mix(0.75, 0.95, cover), 0.985, u_coarseBasemap);
#ifdef HAS_WATER_MASK
    // Water, from the terrain's own mask — but the mask arrives with coarse tiles and is
    // upsampled for finer ones, so its edge runs in 50–100 m stair steps across the coast.
    // The terrain knows better: a water surface in the elevation model is flat to a fraction
    // of a degree, so where the mask lies on ground that slopes even a degree the ground wins
    // and the coast follows the terrain. (Height is no guide: sea level here is an estimate
    // good to several metres, and a cut on it dropped whole harbours.)
    // Along the mask's soft, stepped edge the threshold is jittered by ground-fixed noise, so
    // the shore reads as an irregular line rather than a staircase of blurred squares.
    float m = materialInput.waterMask;
    if (m > 0.02 && m < 0.98)
        m = smoothstep(0.3, 0.7, m + 0.45 * (lmNoiseI(enu / 12.0 + u_mottleFrac1, u_mottleCell1) - 0.5));
    float water = m * (1.0 - smoothstep(0.008, 0.025, slope));
    // On water the paint is a deep sea colour (a little mottled, greyer toward the horizon)
    // over most of Cesium's own water shading — whose wave highlight, under HDR, turned every
    // bay and pond a flat bright cyan — leaving a fifth of it for the Sun's glint and waves.
    if (water > 0.0)
    {
        vec3 sea = mix(vec3(0.05, 0.17, 0.25), vec3(0.08, 0.24, 0.30), patches);
        sea = mix(sea, vec3(0.10, 0.17, 0.24), smoothstep(2000.0, 40000.0, dist));
        material.diffuse = mix(material.diffuse, sea * u_brightness, water);
        alpha = mix(alpha, 0.8 * u_strength, water);
    }
#endif
    material.alpha = alpha;
    return material;
}
`;

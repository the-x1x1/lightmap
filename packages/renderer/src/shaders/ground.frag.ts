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
 * height, slope and aspect (per vertex, from the mesh normals) and noise baked into a small
 * wrapping texture (`noise-texture.ts`), read along a ground-anchored east/north/up frame so
 * patches are fixed to the ground and do not swim as the camera moves, and mipmapped so they
 * settle to their mean at a distance instead of shimmering; the detail tiles nearer the camera
 * fade in by their size on screen. The colour is blended
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
  /**
   * 1 once sea level at the place is known (the terrain's height at the pin against its height
   * above sea level); until then — or where only the ellipsoid is known — no ground is painted
   * as shore. (Washington D.C. sits on a geoid 33 m below the ellipsoid: read as sea level 0,
   * the whole flat city was sand.)
   */
  u_shore: 0,
} as const;

/**
 * The detail tiles (texture pack stage 3): one wrapping, mipmapped texture carrying the four
 * surfaces' light and shade as its channels, in this order (`detail-tiles.ts`).
 */
export const GROUND_DETAIL_UNIFORM = 'u_detailLum';
/** The bundled atlas's quadrants (NW, NE, SW, SE) and the channel each becomes (R, G, B, A). */
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

/** The baked noise (`noise-texture.ts`): one wrapping, mipmapped texture. */
export const GROUND_NOISE_UNIFORM = 'u_noise';
/**
 * Every noise period on the ground divides this (metres), so the camera's position along the
 * ground frame is passed modulo it (`u_camMod`, from the CPU in double) and the pattern never
 * jumps when that wraps; 16 km also keeps the float coordinates precise to millimetres.
 */
export const GROUND_NOISE_WRAP_M = 16384;
/** Ground size of one repeat of the noise texture for each use, metres (each divides the wrap). */
export const GROUND_NOISE_PERIODS_M = {
  /** Turf/scrub patches and the snowline's wobble: fractal cells of 512 m. */
  patches: 4096,
  /** Grain on the ground and on rock: fractal cells of 64 m. */
  grain: 512,
  /** Forest crowns: fractal cells of 64 m, the other seed. */
  crowns: 512,
  /** Cloud shadows: fractal cells of 2 km. */
  clouds: 16384,
  /** The coast's broad jitter: fractal cells of 256 m. */
  coast: 2048,
  /** Mottling: value-noise cells of 64, 16 and 4 m. */
  mottleCoarse: 4096,
  mottleMid: 1024,
  mottleFine: 256,
} as const;

/** The town grid's lattice: 48 m cells, as whole cells and a fraction of the camera's position. */
export const GROUND_TOWN_GRID = {
  cellM: 48,
  cellUniform: 'u_townCell',
  fracUniform: 'u_townFrac',
} as const;

/** The cover map's sampler uniform (an image uniform in Cesium's material fabric: a canvas, or `Material.DefaultImageId`). */
export const GROUND_COVER_IMAGE_UNIFORM = 'u_coverMap';
/** The cover map's bounds uniform, a vec4 (Cartesian4): longitude in radians (west, east), mercator y (north, south). */
export const GROUND_COVER_BOUNDS_UNIFORM = 'u_coverBounds';

const P = GROUND_NOISE_PERIODS_M;
const f = (n: number) => n.toFixed(1);

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
uniform float u_shore;
uniform sampler2D u_detailLum;
uniform sampler2D u_noise;
// The ground frame (east/north/up in world coordinates, anchored to the ground by the host),
// the camera's position along it modulo the noise wrap, in each detail period (the fraction),
// and on the town grid (whole cells and the fraction).
uniform vec3 u_eastWC;
uniform vec3 u_northWC;
uniform vec3 u_upWC;
uniform vec3 u_camMod;
uniform vec3 u_detailOffset;
uniform vec3 u_detailOffset1;
uniform vec3 u_townCell;
uniform vec3 u_townFrac;

// Hash without axis correlation (Hoskins' hash13): one value per cell.
float lmHash(vec3 p)
{
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

// The same on whole cells too large for a float hash (a position in metre cells runs to
// millions): PCG on the integers themselves.
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

// The baked noise at a ground position (metres along the ground frame, wrapped) with a repeat
// of S metres, with explicit derivatives so it can be read inside branches; mipmapped, so a
// pattern too fine for the pixel fades to its mean instead of shimmering.
vec4 lmNoiseTex(vec2 p, float S, vec2 dpx, vec2 dpy)
{
#if __VERSION__ >= 300
    return textureGrad(u_noise, p / S, dpx / S, dpy / S);
#else
    return texture(u_noise, p / S);
#endif
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

// The detail tiles' light and shade at one scale, all four surfaces blended by their weights
// (one fetch per projection: the surfaces are the texture's channels), across the three
// projections of the point by the normal's weights, as a multiplier about 1. Weighted by how
// many screen pixels one period spans: gone below 40 px per period (shrunk further, a tile's
// repeat reads as a grid of dots), full from 160 px, so it fades in as the camera closes.
float lmDetailTier(vec3 q, vec3 dqx, vec3 dqy, vec3 w, vec4 tiles, float amount)
{
    float pxPerPeriod = 1.0 / max(max(length(dqx), length(dqy)), 1e-6);
    float tierW = smoothstep(40.0, 160.0, pxPerPeriod) * amount;
    if (tierW <= 0.001) return 1.0;
#if __VERSION__ >= 300
    float l = dot(textureGrad(u_detailLum, q.yz, dqx.yz, dqy.yz), tiles) * w.x
            + dot(textureGrad(u_detailLum, q.xz, dqx.xz, dqy.xz), tiles) * w.y
            + dot(textureGrad(u_detailLum, q.xy, dqx.xy, dqy.xy), tiles) * w.z;
#else
    float l = dot(texture(u_detailLum, q.xy), tiles);
#endif
    return mix(1.0, l * 2.0, tierW);
}

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec3 positionEC = -materialInput.positionToEyeEC;
    vec3 positionWC = (czm_inverseView * vec4(positionEC, 1.0)).xyz;
    float dist = length(positionEC);
    float slope = materialInput.slope;                // radians, 0 flat
    float height = materialInput.height - u_seaLevelM; // metres above sea level

    // The fragment on the ground frame: camera-relative (precise) plus the camera's own place on
    // it modulo the wrap, so every pattern is fixed to the ground. Its normal on the same axes.
    vec3 local = czm_inverseViewRotation * positionEC;
    vec3 enu = vec3(dot(local, u_eastWC), dot(local, u_northWC), dot(local, u_upWC));
    vec3 g = enu + u_camMod;
    vec3 nW = czm_inverseViewRotation * materialInput.normalEC;
    vec3 nF = vec3(dot(nW, u_eastWC), dot(nW, u_northWC), dot(nW, u_upWC));
    // Steep faces take the noise on a vertical plane facing them (a horizontal projection
    // smears into streaks down a cliff).
    float vert = smoothstep(0.45, 0.75, 1.0 - abs(nF.z));
    vec2 gv = abs(nF.x) > abs(nF.y) ? g.yz : g.xz;
    // Derivatives outside any branch, as GLSL requires.
    vec2 gdx = dFdx(g.xy);
    vec2 gdy = dFdy(g.xy);
    vec2 gvdx = dFdx(gv);
    vec2 gvdy = dFdy(gv);

    // Broad patchiness (~500 m cells, with a second, rotated sample against repetition) and the
    // grain (64 m cells down to 8 m).
    float patches = 0.7 * lmNoiseTex(g.xy, ${f(P.patches)}, gdx, gdy).r
                  + 0.3 * lmNoiseTex(vec2(g.y, -g.x), ${f(P.patches / 2)}, vec2(gdx.y, -gdx.x), vec2(gdy.y, -gdy.x)).b;
    float grain = mix(lmNoiseTex(g.xy, ${f(P.grain)}, gdx, gdy).r,
                      lmNoiseTex(gv, ${f(P.grain)}, gvdx, gvdy).r, vert);

    // Open ground leans from turf and scrub toward steppe and desert with the region's aridity -
    // and, on a slope, with which way it faces: the equatorward face takes the noon Sun and
    // dries to scrub, the poleward face stays greener (a rule of the mid-latitudes; flat ground
    // and the tropics barely move). +1 facing the pole.
    vec2 nH = nF.xy;
    float northness = nH.y / max(length(nH), 1e-4);
    float facing = slope > 0.05 ? northness * u_poleward * smoothstep(0.05, 0.4, slope) : 0.0;
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

    // Steep faces are bare rock, from about 30 deg to 45 deg, broken up by the grain.
    float rocky = smoothstep(0.52, 0.78, slope + 0.12 * (grain - 0.47));
    ground = mix(ground, bare, rocky);

    // Flat ground within a few metres of sea level, next to the sea, reads as shore. The water
    // mask is filtered, so it is above zero for about one of its texels inland of the water:
    // without it, every low flat plain (a delta, a polder, a coastal city) turned to sand.
    float maskNear = 0.0;
#ifdef HAS_WATER_MASK
    maskNear = smoothstep(0.0, 0.15, materialInput.waterMask);
#endif
    float shoreline = u_shore * maskNear * smoothstep(3.0, 1.0, height) * smoothstep(0.10, 0.02, slope);
    ground = mix(ground, shore * (0.9 + 0.2 * grain), shoreline);

    // Snow above the snowline: lower on poleward faces, patchy at its edge, thin on cliffs.
    float snowline = u_snowlineM - 180.0 * facing + 320.0 * (patches - 0.47);
    float snowy = smoothstep(snowline - 220.0, snowline + 160.0, height) * (1.0 - smoothstep(0.85, 1.15, slope));
    snowy = max(snowy, u_ice * (1.0 - smoothstep(0.9, 1.2, slope)));  // an ice sheet is snow at any height
    ground = mix(ground, snow * (0.95 + 0.05 * grain), snowy);

    // The land cover, where a map is loaded and this fragment lies inside it: what the open
    // ground is. Canopy darkens and greens it with a crown-sized grain; fields are a patchwork
    // of tones in cells a few hundred metres across; built-up ground is warm grey; bare is sand
    // and rock by the region's aridity; ice is snow at any height. Rock on steep faces and the
    // seasonal snow still win; unknown texels change nothing.
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
            float crowns = lmNoiseTex(g.xy, ${f(P.crowns)}, gdx, gdy).b;
            vec3 forest = mix(vec3(0.13, 0.25, 0.10), vec3(0.27, 0.38, 0.17), crowns) * (0.9 + 0.2 * grain);
            float fieldTone = lmHash(floor(positionWC / 260.0) + 7.0);
            vec3 field = mix(vec3(0.50, 0.52, 0.28), vec3(0.72, 0.64, 0.40), fieldTone) * (0.9 + 0.2 * grain);
            vec3 town = vec3(0.50, 0.48, 0.45) * (0.9 + 0.15 * grain);
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
    // in by its size on screen, below a mottling that carries the zooms in between - so there
    // is texture at every zoom and no scale ever pops in. On the ground frame plus the camera's
    // own offset in tile periods, so the pattern stays put as the camera moves.
    float nearW = clamp(u_detail - 1.0, 0.0, 1.0) * smoothstep(12000.0, 3000.0, dist);
    vec3 q = enu / 2.5 + u_detailOffset;
    vec3 q1 = enu / 6.7 + u_detailOffset1 + 0.37;
    vec3 dqx = dFdx(q);
    vec3 dqy = dFdy(q);
    // Screen pixels per metre of ground here, for the fades below.
    float pxPerM = 1.0 / max(max(length(dqx), length(dqy)) / 2.5, 1e-6);
    if (nearW > 0.0 && u_detailOn > 0.5)
    {
        // A sharp triplanar: a face takes one projection.
        vec3 w = abs(nF);
        w = w * w * w * w;
        w = w * w;
        w /= (w.x + w.y + w.z + 1e-5);
        // The surfaces' weights: snow, then rock on steep or alpine ground (and streets), sand
        // on the shore, bare desert and arid open ground, grass (and the forest floor) for the rest.
        float wSnow = snowy;
        float wRock = (1.0 - snowy) * max(rocky, max(alpine * (1.0 - 0.6 * u_aridity), built));
        float wSand = (1.0 - snowy) * (1.0 - rocky) * max(shoreline, max(bareC, u_aridity * (1.0 - canopy)));
        float wGrass = (1.0 - snowy) * (1.0 - max(wRock, wSand));
        vec4 tiles = vec4(wGrass, wRock, wSand, wSnow);
        tiles /= max(dot(tiles, vec4(1.0)), 1e-4);
        float k1 = 2.5 / 6.7;
        ground *= lmDetailTier(q1, dqx * k1, dqy * k1, w, tiles, 0.4 * nearW)
                * lmDetailTier(q, dqx, dqy, w, tiles, 0.55 * nearW);
    }

    // Mottling between the macro patches and the tiles: value noise at 64, 16 and 4 m cells,
    // each fading in as its cells grow past a few pixels on screen (the mip chain fades it out
    // again as they shrink). The broad scale also shifts the hue - drier and yellower in its
    // light patches - as real ground does. The coarser two also jitter the coast below.
    float n64 = lmNoiseTex(g.xy, ${f(P.mottleCoarse)}, gdx, gdy).g - 0.5;
    float n16 = lmNoiseTex(g.xy, ${f(P.mottleMid)}, gdx, gdy).a - 0.5;
    if (u_detail > 1.0)
    {
        float mW = clamp(u_detail - 1.0, 0.0, 1.0) * (1.0 - 0.6 * snowy);
        float w2 = smoothstep(3.0, 10.0, pxPerM * 64.0);
        float w1 = smoothstep(3.0, 10.0, pxPerM * 16.0);
        float w0 = smoothstep(3.0, 10.0, pxPerM * 4.0);
        float n4 = lmNoiseTex(g.xy, ${f(P.mottleFine)}, gdx, gdy).g - 0.5;
        ground = mix(ground, ground * vec3(1.08, 1.03, 0.88), clamp(mW * w2 * n64 * 0.9, 0.0, 0.4));
        ground *= 1.0 + mW * (0.26 * w2 * n64 + 0.2 * w1 * n16 + 0.14 * w0 * n4);
    }

    // Built-up ground close enough to read: a street grid on ground-fixed 48 m cells along the
    // place's east and north - blocks two cells long (48 x 96 m), every fourth street east-west
    // and every third north-south a wider avenue - and inside each block lots of about 16 x 12 m,
    // each a roof or yard of its own (grey, warm, a few pale roofs, a few trees), with one block
    // in ten a park. It fades in as the blocks grow past a few pixels and the lots as they do;
    // steep ground stays as it is. A pattern of a city, not its streets.
    float townW = known * built * (1.0 - snowy) * (1.0 - rocky) * smoothstep(4.0, 12.0, pxPerM * 48.0);
    if (townW > 0.0)
    {
        vec2 bq = enu.xy / 48.0 + u_townFrac.xy;
        vec2 bf = fract(bq);
        vec2 bi = floor(bq) + u_townCell.xy;
        // Along north the blocks pair cells: where in the pair, and which street line is nearest.
        float pairY = floor(bi.y * 0.5);
        float fy = (bi.y - 2.0 * pairY + bf.y) * 0.5;
        float lineX = bf.x < 0.5 ? bi.x : bi.x + 1.0;
        float lineY = fy < 0.5 ? pairY : pairY + 1.0;
        float halfX = mod(lineX, 4.0) < 0.5 ? 9.0 : 5.0;   // half the street's width, metres
        float halfY = mod(lineY, 3.0) < 0.5 ? 9.0 : 5.0;
        float ex = min(bf.x, 1.0 - bf.x) * 48.0;           // metres to the street's centre line
        float ey = min(fy, 1.0 - fy) * 96.0;
        float aa = 1.0 / max(pxPerM, 1e-3);                // a pixel, in metres
        float street = max(1.0 - smoothstep(halfX - aa, halfX + aa, ex),
                           1.0 - smoothstep(halfY - aa, halfY + aa, ey));
        float park = step(0.9, lmHashI(vec3(bi.x, pairY, 7.0)));
        // Lots: three across a cell, four along it, numbered on the same ground-fixed lattice.
        vec2 lotId = bi * vec2(3.0, 4.0) + floor(bf * vec2(3.0, 4.0));
        float lot = lmHashI(vec3(lotId, 5.0));
        float kind = fract(lot * 7.31);
        vec3 roof = mix(vec3(0.40, 0.39, 0.38), vec3(0.60, 0.56, 0.50), lot);
        roof = mix(roof, vec3(0.74, 0.73, 0.71), step(0.9, kind));                       // pale roofs
        roof = mix(roof, vec3(0.20, 0.29, 0.15) * (0.85 + 1.2 * n16), step(kind, 0.16)); // trees
        float lotW = smoothstep(3.0, 8.0, pxPerM * 12.0);
        vec3 block = mix(vec3(0.50, 0.48, 0.45), roof, lotW);
        vec3 green = vec3(0.24, 0.34, 0.18) * (0.85 + n16);
        block = mix(block, green, park);
        vec3 city = mix(block, vec3(0.31, 0.31, 0.32), street);
        ground = mix(ground, city, townW * 0.8);
    }

    // Micro-relief: the grain read as small bumps, lit by the scene's own Sun direction, so rock
    // and scree show texture that turns with the light through the day. A shading of the albedo
    // only (the mesh, its normals and the shadows are untouched), strongest on bare ground, gone
    // on snow, and fading beyond a few kilometres where it would only shimmer.
    float reliefW = clamp(u_detail - 1.0, 0.0, 1.0)
        * max(rocky, alpine * 0.7) * (1.0 - snowy) * smoothstep(6000.0, 800.0, dist);
    if (reliefW > 0.0)
    {
        // Forward differences of the grain on its own plane: two more samples.
        vec2 pr = mix(g.xy, gv, step(0.5, vert));
        vec2 prdx = mix(gdx, gvdx, step(0.5, vert));
        vec2 prdy = mix(gdy, gvdy, step(0.5, vert));
        float g0 = lmNoiseTex(pr, ${f(P.grain)}, prdx, prdy).r;
        float gx = lmNoiseTex(pr + vec2(6.0, 0.0), ${f(P.grain)}, prdx, prdy).r - g0;
        float gy = lmNoiseTex(pr + vec2(0.0, 6.0), ${f(P.grain)}, prdx, prdy).r - g0;
        vec3 bumpEC = normalize(materialInput.normalEC + materialInput.tangentToEyeMatrix * vec3(-gx * 2.5, -gy * 2.5, 0.0));
        float flat_ = max(dot(materialInput.normalEC, czm_lightDirectionEC), 0.0);
        float bumped = max(dot(bumpEC, czm_lightDirectionEC), 0.0);
        ground *= clamp(1.0 + reliefW * 0.9 * (bumped - flat_), 0.7, 1.3);
    }

    // Broken cloud: patches of shadow the size of cumulus (a kilometre or two) drifting with the
    // planner's clock toward the north-east at ~ 200 m/min, over everything but water. A
    // dappling of the albedo - the light's direction, the terrain shadows and the sky are
    // untouched; the patches are a pattern, not the forecast's own clouds.
    if (u_cloudShadow > 0.0 && u_detail > 0.0)
    {
        vec2 pc = g.xy - vec2(190.0, 60.0) * u_cloudTime;
        float cloud = 0.7 * lmNoiseTex(pc, ${f(P.clouds)}, gdx, gdy).r
                    + 0.3 * lmNoiseTex(vec2(pc.y, -pc.x), ${f(P.clouds / 2)}, vec2(gdx.y, -gdx.x), vec2(gdy.y, -gdy.x)).b;
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
    // put sea and lakes well onto the land near every coast.
    float cover = max(rocky, max(snowy, max(alpine * 0.8, known * 0.9)));
    float alpha = u_strength * mix(mix(0.75, 0.95, cover), 0.985, u_coarseBasemap);
#ifdef HAS_WATER_MASK
    // Water, from the terrain's own mask - which arrives with coarse tiles and is upsampled for
    // finer ones, so its edge runs in 50-100 m stair steps. A water surface in the elevation
    // model is flat to a fraction of a degree, so where the mask lies on ground that slopes even
    // a degree the ground wins. Along the mask's soft edge the threshold is jittered by
    // ground-fixed noise, so the shore reads as an irregular line rather than a staircase.
    float m = materialInput.waterMask;
    float mJitter = smoothstep(0.3, 0.7, m + 0.5 * n64 + 0.3 * n16
        + 0.7 * smoothstep(2000.0, 20000.0, dist) * (lmNoiseTex(g.xy, ${f(P.coast)}, gdx, gdy).r - 0.47));
    // Where sea level is known (the bundled geoid, set to the sea as the terrain has it nearby),
    // ground well above it is land whatever the mask's coarse texels say (they otherwise run
    // the sea up a coastal slope). Only well above: a canal or a river mouth narrower than the
    // terrain's own spacing reads 2-4 m above the sea in the terrain (Waikiki's Ala Wai), and a
    // beach park sits within a metre of it, so nearer sea level the mask still decides.
    float lowW = u_shore * (1.0 - smoothstep(8.0, 12.0, height));
    float coastLand = smoothstep(4.0, 6.0, height + 0.5 * n16);
    m = mix(m, mJitter, step(0.02, m) * step(m, 0.98));
    // The terrain carries the sea floor near the coast (and the banks of a canal), sloping
    // below sea level: there the flatness test would paint land, so mask water below sea level
    // is water however it slopes.
    float below = lowW * step(0.02, materialInput.waterMask)
                * (1.0 - smoothstep(0.2, 0.6, height + 0.3 * n16));
    float water = max(m * (1.0 - smoothstep(0.008, 0.025, slope)), below) * (1.0 - lowW * coastLand);
    // On water the paint is a deep sea colour (a little mottled, greyer toward the horizon) over
    // most of Cesium's own water shading, leaving some for the Sun's glint and waves.
    if (water > 0.0)
    {
        vec3 sea = mix(vec3(0.05, 0.17, 0.25), vec3(0.08, 0.24, 0.30), patches);
        sea = mix(sea, vec3(0.10, 0.17, 0.24), smoothstep(2000.0, 40000.0, dist));
        material.diffuse = mix(material.diffuse, sea * u_brightness, water);
        // Water seen at a grazing angle is a mirror (Fresnel): toward the horizon the paint
        // gives way to the globe's own water shading - the sky's light and the Sun's glint.
        float cosView = clamp(dot(materialInput.normalEC, normalize(materialInput.positionToEyeEC)), 0.0, 1.0);
        float fresnel = pow(1.0 - cosView, 3.0);
        alpha = mix(alpha, 0.8 * u_strength * (1.0 - 0.8 * fresnel), water);
    }
#endif
    // From orbit the bundled basemap is the better picture of the Earth: the paint fades out
    // between 150 and 600 km from the camera.
    alpha *= 1.0 - smoothstep(150000.0, 600000.0, dist);
    material.alpha = alpha;
    return material;
}
`;

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
 * moves (float ECEF jitter is ~0.5 m; the finest world-anchored octave is 8 m; a metre-scale
 * grain near the camera is computed camera-relative with the camera's own cell offset passed in,
 * and fades out by 500 m). The colour is blended
 * over the basemap with an alpha that rises on rock and snow and falls on open ground, so a
 * real imagery layer, where one is licensed, still shows through where it matters — vegetation
 * hue, desert, farmland — and the procedural surface supplies the detail the basemap lacks.
 *
 * The one regional cue it takes is the bundled basemap's own colour around the place (sampled
 * once per place by the host): green leans the open ground to turf, tan to steppe and desert,
 * white to an ice sheet. A texture, not a land-cover dataset: it does not know a forest from a
 * field, a glacier from a snowfield, or a city at all. `RENDERING_ACCURACY.md` says so.
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
} as const;

export const GROUND_MATERIAL_SOURCE = /* glsl */ `
uniform float u_snowlineM;
uniform float u_treelineM;
uniform float u_poleward;
uniform float u_strength;
uniform float u_aridity;
uniform float u_ice;
uniform float u_brightness;
uniform float u_seaLevelM;
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
    float aspect = materialInput.aspect;              // radians, 0 east, pi/2 north

    // Open ground leans from turf and scrub toward steppe and desert with the region's aridity.
    vec3 turf  = mix(vec3(0.33, 0.45, 0.20), vec3(0.62, 0.55, 0.36), u_aridity);
    vec3 scrub = mix(vec3(0.52, 0.46, 0.27), vec3(0.74, 0.64, 0.44), u_aridity);
    vec3 rock  = vec3(0.52, 0.49, 0.45);
    vec3 scree = vec3(0.40, 0.38, 0.34);
    vec3 snow  = vec3(0.93, 0.95, 0.97);
    vec3 shore = vec3(0.74, 0.69, 0.55);

    // Open ground: turf and scrub in patches, grained.
    vec3 ground = mix(turf, scrub, smoothstep(0.32, 0.62, patches));
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
    float poleward = slope > 0.05 ? sin(aspect) * u_poleward * smoothstep(0.05, 0.4, slope) : 0.0;  // +1 facing the pole
    float snowline = u_snowlineM - 180.0 * poleward + 320.0 * (patches - 0.47);
    float snowy = smoothstep(snowline - 220.0, snowline + 160.0, height) * (1.0 - smoothstep(0.85, 1.15, slope));
    snowy = max(snowy, u_ice * (1.0 - smoothstep(0.9, 1.2, slope)));  // an ice sheet is snow at any height
    ground = mix(ground, snow * (0.95 + 0.05 * grain), snowy);

    // Close to the camera (a viewpoint's foreground) a metre-scale grain, fading out by 500 m so
    // it never shimmers at a distance. It is anchored to the ground, not the camera: the
    // camera-relative position (precise) plus the camera's own position in grain cells (whole
    // cells into the lattice, the fraction into the coordinate, both from the CPU in double).
    float dist = length(positionEC);
    float nearW = smoothstep(500.0, 60.0, dist);
    if (nearW > 0.0)
    {
        vec3 local = czm_inverseViewRotation * positionEC / 2.5 + u_cameraFrac;
        float fine = lmNoiseAt(local, u_cameraCell) * 0.6 + lmNoiseAt(local * 2.0 + 0.5, u_cameraCell * 2.0) * 0.3;
        ground *= 1.0 + nearW * 0.3 * (fine - 0.45);
    }

    // Micro-relief: the grain read as small bumps, lit by the scene's own Sun direction, so rock
    // and scree show texture that turns with the light through the day. A shading of the albedo
    // only (the mesh, its normals and the shadows are untouched), strongest on bare ground, gone
    // on snow, and fading beyond a few kilometres where it would only shimmer.
    float reliefW = max(rocky, alpine * 0.7) * (1.0 - snowy) * smoothstep(6000.0, 800.0, dist);
    if (reliefW > 0.0)
    {
        float e = 6.0;
        vec3 pe = positionWC / 60.0 + 5.0;
        float gx = lmFbm(pe + vec3(e / 60.0, 0.0, 0.0)) - lmFbm(pe - vec3(e / 60.0, 0.0, 0.0));
        float gy = lmFbm(pe + vec3(0.0, e / 60.0, 0.0)) - lmFbm(pe - vec3(0.0, e / 60.0, 0.0));
        // The gradient is in world axes; read it as east/north in the surface frame (the
        // difference is a rotation of a random field, which changes nothing a viewer can tell).
        vec3 bumpEC = normalize(materialInput.normalEC + materialInput.tangentToEyeMatrix * vec3(-gx * 2.5, -gy * 2.5, 0.0));
        float flat_ = max(dot(materialInput.normalEC, czm_lightDirectionEC), 0.0);
        float bumped = max(dot(bumpEC, czm_lightDirectionEC), 0.0);
        ground *= clamp(1.0 + reliefW * 0.9 * (bumped - flat_), 0.7, 1.3);
    }

    material.diffuse = ground * u_brightness;
    // Rock and snow are what they are; open ground lets the basemap's own hue through.
    float cover = max(rocky, max(snowy, alpine * 0.8));
    float alpha = u_strength * mix(0.75, 0.95, cover);
#ifdef HAS_WATER_MASK
    alpha *= 1.0 - materialInput.waterMask;
#endif
    material.alpha = alpha;
    return material;
}
`;

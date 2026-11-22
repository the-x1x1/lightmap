/**
 * OpenStreetMap buildings around the camera, extruded on the terrain (the free buildings: no
 * Cesium ion token). Each z14 OpenMapTiles vector tile near where you stand or look is fetched,
 * its footprints read (`osm-buildings.ts`), the ground under each sampled from the terrain, and
 * the lot drawn as lit, shadow-casting, pickable prisms. The same tile's land cover grows trees
 * (`treesFromTile`): woods filled, parks scattered. Tiles far behind are dropped again.
 *
 * A tile's buildings are first built whole, as one primitive in Cesium's workers: nothing is
 * triangulated on the main thread, and a dense tile (Kyoto's hold 10,000-20,000 footprints)
 * shows in seconds. One outline the workers cannot triangulate fails that primitive; it is
 * dropped before its frame (a failed asynchronous `Primitive` would throw from inside the
 * frame) and the tile is built instead on the main thread a slice at a time, each building in
 * its own try, so a malformed outline costs that building only. Those slices, and the trees (in
 * slices of 1,500, which keep their ids), are then built again in the workers as one primitive
 * each, which replaces them when it is ready: a dense tile otherwise stayed dozens of
 * primitives (Midtown ~220, Kyoto ~370 on screen, each drawn again for every shadow cascade).
 */
import type * as Cesium from '@cesium/engine';
import {
  BUILDING_TILE_ZOOM,
  buildingTilesAround,
  buildingsFromTileSteps,
  tileUrl,
  treesFromTile,
  type BuildingFootprint,
  type TreeSpot,
} from '../osm-buildings.ts';
import { lonLatToTile, tilePointToLonLat } from '../vector-tile.ts';
import {
  HIP_ROOF_VERTICES,
  HOUSE_ROOFS,
  hipRoofFor,
  hipRoofIndices,
  hipRoofMesh,
  roofShade,
  type HipRoof,
} from '../house-roofs.ts';
import { deciduousCrown } from '../leaf-season.ts';
import { bridgeAt, bridgeLinesFromTile, type BridgeLine } from '../vector-cover.ts';

type CesiumModule = typeof Cesium;

/** Tiles reaching within this distance of the focus are loaded in full (every building, trees). */
const LOAD_RADIUS_M = 1800;
/**
 * Out to this distance only the tall buildings are loaded: the skyline across a bay or seen
 * from a hill, which is what a photographer frames from afar.
 */
const FAR_RADIUS_M = 6000;
const FAR_MIN_HEIGHT_M = 20;
/** Tiles whose centre is further than this from the focus are dropped. */
const KEEP_RADIUS_M = 8000;
/** Beyond this camera height above the focus, nothing new is loaded (buildings would be specks). */
const MAX_LOAD_HEIGHT_M = 6000;
/** Footprints turned into geometry per slice (one slice per ~frame). */
const SLICE = 250;
/**
 * Main-thread time one building slice may take, ms: Cesium triangulates footprints on the main
 * thread here (one bad footprint must not lose its neighbours), so a slice stops when its budget
 * is spent and the rest waits for the next frame.
 */
const SLICE_BUDGET_MS = 6;
/**
 * Pitched roofs to a primitive (42,000 vertices): what the main thread prepares in the one frame
 * that first draws it.
 */
const ROOFS_PER_PRIMITIVE = 1500;
/** A tile's merge not ready by then is given up (its slices stay). */
const MERGE_TIMEOUT_MS = 60_000;

/** The next frame (or, in a page that draws no frames, 50 ms). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 50);
  });
}
/** The building's base sits this far into the ground, so a slope never shows a gap under it. */
const SINK_M = 2;
/**
 * The n.l over which Cesium's shadow map fades a primitive's face into shadow by its normal
 * (`normalShadingSmooth` of its primitive bias); the host sets the same value.
 */
export const PRIMITIVE_NORMAL_SHADING_SMOOTH = 0.05;

/**
 * How a building's walls are glazed, carried in its colour's alpha (the buildings are drawn
 * opaque, so alpha is free; the shader reads it and writes 1): windows punched in a wall,
 * ribbons of glass between bands of wall, or a curtain wall - glass from slab to slab. The
 * steps are five of a byte's 255 apart, so the colour attribute's rounding keeps them.
 */
export const FACADE_ALPHA = { punched: 1, ribbon: 0.98, curtain: 0.96 } as const;
export type FacadeKind = keyof typeof FACADE_ALPHA;

/**
 * A house's pitched roof (house-roofs.ts) carries this in its alpha: its colour is its roofing
 * and is drawn as it is, where a flat roof's is its building's walls' and is turned to tar.
 */
export const ROOF_ALPHA = 0.94;

/** The towers' glazing, in the order of their materials (`HIGH_RISE`). */
const HIGH_RISE_KIND: FacadeKind[] = ['curtain', 'ribbon', 'punched', 'curtain'];

/**
 * A building's glazing from its height and its own number `h` (0..1, the one its facade's
 * colour is picked by): a tower over 35 m takes its material's - curtain walls for the glass
 * towers, ribbons for steel and glass, punched windows for concrete; a quarter of the blocks
 * between 12 m and 35 m (offices, schools, flats of the last sixty years) have ribbons; houses
 * and everything else have windows punched in their walls.
 */
export function facadeKind(heightM: number, h: number): FacadeKind {
  const u = Math.min(0.999999, Math.max(0, h));
  if (heightM > 35) return HIGH_RISE_KIND[Math.floor(u * HIGH_RISE_KIND.length)] ?? 'punched';
  if (heightM > 12 && (u * 13.7) % 1 < 0.25) return 'ribbon';
  return 'punched';
}

/**
 * The buildings' and trees' fragment shader: Cesium's per-instance colour appearance lights
 * every face from the camera (a headlight), which would light a wall facing away from the Sun
 * as brightly as one facing it. Here the Sun (the scene light) lights the faces that face it,
 * a sky term, stronger on faces that look up, lights the rest, and light bounced off the sunlit
 * ground reaches the faces that look down (a crown's underside, an overhang) - all scaled by
 * the light's own colour, so dusk and night dim buildings with the ground.
 *
 * Shadows come on top from Cesium's shadow map, which multiplies the whole colour by its
 * darkness wherever the Sun is hidden - including every face turned away from the Sun, which
 * Cesium shades as in shadow by its normal. Those faces already carry only sky and bounce
 * light here, so the two together made them near black (a tree's underside at noon). The
 * shader divides out the factor Cesium will apply to an unoccluded face (`shadowD` is the
 * shadow map's darkness, 1 with shadows off; Cesium leaves fragments past `shadowMaxM`
 * alone), so a face turned away from the Sun shows its sky light, and a face the Sun would
 * light but something hides still darkens as the ground's shadows do.
 * ASCII only (some drivers reject anything else in shader source).
 */
/**
 * The globe's fog on a tree or a building. Cesium fogs the ground it draws (1 - exp(-(density *
 * distance)^2), toward the ground atmosphere's colour) but not primitives; so in a drizzle, with
 * the visibility at a kilometre or two, the hillside behind a town went into the grey while its
 * woods stood out on nothing - dark balls hung in the sky (V&V: Tromsø, November). Each fragment
 * takes the same fog, by the same uniforms, as the ground beside it, as Cesium's own models do
 * (its FogStage): the ground atmosphere's colour at the fragment, shifted as the globe's is,
 * darkened by the light's height, tonemapped as without HDR. The globe's fog is computed before
 * its shadow is laid, and so is this. ASCII only.
 */
export const PRIMITIVE_FOG_GLSL = `
    {
        vec3 fogLight = czm_getDynamicAtmosphereLightDirection(positionWC, czm_atmosphereDynamicLighting);
        vec3 rayleighColor;
        vec3 mieColor;
        float fogOpacity;
        czm_computeGroundAtmosphereScattering(positionWC, fogLight, rayleighColor, mieColor, fogOpacity);
        rayleighColor = czm_applyHSBShift(rayleighColor, czm_atmosphereHsbShift, true);
        mieColor = czm_applyHSBShift(mieColor, czm_atmosphereHsbShift, true);
        vec3 fogColor = czm_computeAtmosphereColor(positionWC, fogLight, rayleighColor, mieColor, fogOpacity).rgb;
        if (czm_atmosphereDynamicLighting != 0.0) {
            fogColor *= clamp(dot(normalize(czm_viewerPositionWC), fogLight), czm_fogMinimumBrightness, 1.0);
        }
#ifndef HDR
        fogColor = czm_inverseGamma(czm_pbrNeutralTonemapping(fogColor));
#endif
        outRgb = czm_fog(length(v_positionEC), outRgb, fogColor, czm_fogVisualDensityScalar);
    }`;

export function litInstanceShader(
  shadowD = 1,
  shadowMaxM = 0,
  roofs = false,
  directShare = 1,
  skyLift = 1,
  cityLights = 0,
  snow = 0,
  wet = 0,
): string {
  const d = Math.max(0.05, Math.min(1, shadowD)).toFixed(3);
  // The share of the Sun's term that is direct (globeLightSplit's directional share against a
  // clear day's): under an overcast or in twilight the light has little direction, so the rest
  // comes from the sky - most on faces that look up, as a diffuse sky lights them - and a flat
  // roof keeps exactly the level it had (its Sun term is sunUp, all of which comes back).
  const k = Math.max(0, Math.min(1, directShare)).toFixed(2);
  // Once the beam has gone all the light is sky light, and the ground takes the whole of it
  // (globeLightSplit): the sky terms are lifted with it, so a dusk street is not three times
  // darker than the ground it stands on.
  const lift = Math.max(1, Math.min(3.4, skyLift)).toFixed(2);
  const maxM = Math.max(0, shadowMaxM).toFixed(1);
  // Buildings: a flat roof is tar, gravel or membrane, a pitched one shingle or tile - darker
  // than the walls, and from a viewpoint stood on a roof or a map view the roofs are most of
  // what shows (V&V: every roof the colour of its walls). Each building's own tone picks a
  // shade of grey; tile colours are regional and left to OSM's own roof colour some day. A
  // house's pitched roof is drawn in its own colour, its roofing (ROOF_ALPHA).
  const roofCode = roofs
    ? `
    float roofness = smoothstep(0.55, 0.85, dot(normalEC, upEC));
    float pick = fract(v_color.r * 97.0 + v_color.g * 13.0);
    vec3 roofCol = vec3(0.30, 0.30, 0.31) * (0.75 + 0.6 * pick);
    color.rgb = mix(color.rgb, czm_gammaCorrect(vec4(roofCol, 1.0)).rgb,
        0.7 * roofness * step(${((ROOF_ALPHA + FACADE_ALPHA.curtain) / 2).toFixed(2)}, v_color.a));`
    : '';
  // Lying snow (the ground texture's snowCover): it settles on whatever looks up - flat and
  // gently pitched roofs, the tops of crowns - and slides off walls and steep faces.
  const s = Math.max(0, Math.min(1, snow));
  const snowCode =
    s > 0
      ? `
    float snowUp = smoothstep(0.35, 0.8, dot(normalEC, upEC));
    color.rgb = mix(color.rgb, czm_gammaCorrect(vec4(0.90, 0.92, 0.95, 1.0)).rgb, ${s.toFixed(2)} * snowUp);`
      : '';
  // Rain-wet walls, roofs and leaves (the ground texture's `wet`): water in the surface darkens
  // them as it does the ground, about a quarter at the wettest, under any snow.
  const w = Math.max(0, Math.min(1, wet));
  const wetCode =
    w > 0
      ? `
    color.rgb *= ${(1 - 0.25 * w).toFixed(3)};`
      : '';
  return `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec4 v_color;

void main()
{
    vec3 normalEC = normalize(v_normalEC);
    vec3 shadeNormalEC = normalEC;
#ifdef FACE_FORWARD
    normalEC = faceforward(normalEC, vec3(0.0, 0.0, 1.0), -normalEC);
#endif
    vec4 color = czm_gammaCorrect(v_color);
    vec3 positionWC = (czm_inverseView * vec4(v_positionEC, 1.0)).xyz;
    vec3 upEC = normalize((czm_view * vec4(normalize(positionWC), 0.0)).xyz);${roofCode}${wetCode}${snowCode}
    float sun = max(dot(normalEC, czm_lightDirectionEC), 0.0);
    float sky = 0.5 + 0.5 * dot(normalEC, upEC);
    float sunUp = clamp(dot(upEC, czm_lightDirectionEC), 0.0, 1.0);
    float bounce = 0.12 * (1.0 - sky) * sunUp;
    float diffuseSun = 0.55 * (1.0 - ${k}) * sunUp * (0.5 + 0.5 * sky);
    vec3 light = czm_lightColor * (0.55 * ${k} * sun + (0.16 + 0.14 * sky) * ${lift} + bounce + diffuseSun);
    vec3 lit = color.rgb * light;
    // The grade's aerial perspective takes every pixel by its depth, these primitives' too; and
    // the globe's own fog, which the ground under them is drawn through, is laid on them here
    // as Cesium lays it on the ground (PRIMITIVE_FOG_GLSL) - not a haze of their own.
    vec3 outRgb = lit;${roofs ? windowsCode(cityLights, lift, k) : ''}${PRIMITIVE_FOG_GLSL}
    // Cesium's factor for an unoccluded fragment: its normal shading over the first
    // PRIMITIVE_NORMAL_SHADING_SMOOTH of n.l, floored at the darkness; none beyond the shadow
    // distance.
    float cesiumSun = max(dot(shadeNormalEC, czm_lightDirectionEC), 0.0);
    float expected = max(clamp(cesiumSun / ${PRIMITIVE_NORMAL_SHADING_SMOOTH.toFixed(3)}, 0.0, 1.0), ${d});
    if (-v_positionEC.z < ${maxM}) outRgb /= expected;
    out_FragColor = vec4(outRgb, color.a);
}
`;
}

/**
 * Windows. The walls carry a grid of them - bays 3.6 m wide, storeys 3.2 m tall - glazed in one
 * of three ways, which a building carries in its colour's alpha (`FACADE_ALPHA`; the shader
 * writes 1): windows punched in a wall, each 40 % of its bay's width and half its storey's
 * height (a fifth of the wall); ribbons of glass from mullion to mullion between bands of wall
 * (two fifths); or a curtain wall, glass from slab to slab (three quarters). By day a window is
 * glass: darker than its wall (a third to a half of it, pane by pane), with the sky's light
 * glancing off it - more the more obliquely the wall is seen, as glass mirrors at a grazing
 * angle; so a wall has a scale, and a building is not a painted box. And it mirrors the Sun:
 * where the eye stands in a pane's mirrored beam the pane blazes, each pane a little off true,
 * so a wall turned to a low Sun shows a patch of blazing panes about the mirror's place (the
 * direct beam's share `direct` of it; a sheen once the panes cannot be told apart). From the
 * dusk on (`cityLights`, 0..1) up to 38 % of them are lit, each its own warm-to-cool white and
 * brightness, picked by a hash of the window and the building's tone so a window stays lit or
 * dark; that light is the window's own: added after the shading, not scaled by the scene's
 * light. Where a pixel spans more than about half a window the grid gives way to its mean - the
 * wall's share of glass, every pane alike - and a far town at night is a haze of warm light
 * rather than shimmering dots.
 *
 * The grid is anchored to the world, not the eye: across a wall by the wall's horizontal
 * direction (rounded to 1/1024, so every fragment of a wall takes the same) dotted with the
 * camera's position split as Cesium splits it (high part, fixed within 65 km, taken modulo
 * 64 bays; low part and the fragment's offset from the eye, both small and exact), up it by the
 * height above the ellipsoid (the eye's height plus the offset). Storeys count from sea level,
 * not each building's base. ASCII only.
 */
function windowsCode(cityLights: number, lift = '1.00', direct = '1.00'): string {
  const on = Math.max(0, Math.min(1, cityLights));
  const onS = on.toFixed(2);
  return `
    float ribbon = step(v_color.a, ${((FACADE_ALPHA.punched + FACADE_ALPHA.ribbon) / 2).toFixed(2)});
    float curtain = step(v_color.a, ${((FACADE_ALPHA.ribbon + FACADE_ALPHA.curtain) / 2).toFixed(2)});
    color.a = 1.0;
    float wallness = 1.0 - smoothstep(0.35, 0.6, abs(dot(normalEC, upEC)));
    if (wallness > 0.0)
    {
        vec3 relMC = (czm_inverseModelView * vec4(v_positionEC, 0.0)).xyz;
        vec3 nMC = (czm_inverseModelView * vec4(normalEC, 0.0)).xyz;
        vec3 uMC = (czm_inverseModelView * vec4(upEC, 0.0)).xyz;
        vec3 t = cross(uMC, nMC);
        t = floor(t / max(length(t), 1e-4) * 1024.0 + 0.5) / 1024.0;
        float along = mod(dot(t, czm_encodedCameraPositionMCHigh), 230.4)
                    + dot(t, czm_encodedCameraPositionMCLow) + dot(t, relMC);
        vec3 relWC = (czm_inverseView * vec4(v_positionEC, 0.0)).xyz;
        float up = czm_eyeHeight + dot(relWC, normalize(positionWC));
        vec2 cell = vec2(along / 3.6, up / 3.2);
        vec2 id = floor(cell);
        vec2 f = fract(cell);
        vec2 fw = max(fwidth(cell), vec2(1e-4));
        // A window's place in its bay and storey: punched, a ribbon, or a curtain wall's pane.
        vec2 wLo = mix(vec2(0.30, 0.30), mix(vec2(0.03, 0.34), vec2(0.04, 0.09), curtain), ribbon);
        vec2 wHi = mix(vec2(0.70, 0.80), mix(vec2(0.97, 0.80), vec2(0.96, 0.91), curtain), ribbon);
        float inX = smoothstep(wLo.x - fw.x, wLo.x + fw.x, f.x) - smoothstep(wHi.x - fw.x, wHi.x + fw.x, f.x);
        float inY = smoothstep(wLo.y - fw.y, wLo.y + fw.y, f.y) - smoothstep(wHi.y - fw.y, wHi.y + fw.y, f.y);
        float share = (wHi.x - wLo.x) * (wHi.y - wLo.y);
        // The building's own number, from its colour's bytes: the interpolated colour of a
        // one-coloured wall can differ in its last bit from pixel to pixel, which the hash
        // would turn into a window lit in specks.
        vec2 own = floor(v_color.rb * 255.0 + 0.5);
        float hsh = fract(sin(dot(id, vec2(12.9898, 78.233)) + dot(own, vec2(0.3596, 0.1463))) * 43758.5453);
        float far = smoothstep(0.25, 0.6, max(fw.x, fw.y));
        // By day a window is glass: darker than its wall - most of the light goes in and does
        // not come back - with the sky's light glancing off it, a little differently pane by
        // pane (blinds, curtains) and more at a grazing angle. A far wall takes the mean of its
        // glass and wall, every pane alike.
        float glass = mix(inX * inY, share, far);
        float graze = 1.0 - abs(dot(normalEC, normalize(-v_positionEC)));
        graze = graze * graze * graze;
        vec3 pane = lit * (0.34 + 0.22 * mix(fract(hsh * 5.9), 0.5, far))
                  + czm_lightColor * vec3(0.07, 0.09, 0.12) * (0.4 + 0.6 * sky) * ${lift}
                    * (1.0 + 0.8 * curtain + 3.0 * graze);
        outRgb = mix(outRgb, pane, glass * wallness);
        // The Sun in the glass. A pane mirrors the Sun to an eye that stands where the mirrored
        // beam goes - a low Sun, a wall turned to it, the eye on the Sun's side: a tower
        // catching the sunset. No pane hangs quite true (each is off by up to a degree, its own
        // way), so a wall does not flash as one mirror: panes blaze singly in a patch about the
        // mirror's place, and the patch moves over the wall as the eye or the Sun does. Past
        // telling the panes apart the patch is its mean, a sheen. Only the Sun's own beam is
        // mirrored - none under an overcast, none from a Sun below the horizon.
        vec3 paneTilt = (vec3(fract(hsh * 13.1), fract(hsh * 29.7), fract(hsh * 47.3)) - 0.5) * 0.02;
        vec3 mirrored = reflect(normalize(v_positionEC), normalize(normalEC + paneTilt * (1.0 - far)));
        float offSun = sqrt(max(2.0 * (1.0 - dot(mirrored, czm_lightDirectionEC)), 0.0));
        float blaze = mix(1.0 - smoothstep(0.006, 0.016, offSun),
                          0.22 * (1.0 - smoothstep(0.012, 0.045, offSun)), far);
        float sunOver = smoothstep(0.0, 0.03, dot(upEC, czm_lightDirectionEC));
        outRgb += czm_lightColor * (4.0 * ${direct} * blaze * sunOver * glass * wallness);${
          on > 0
            ? `
        float litW = step(hsh, 0.38 * ${onS});
        float hue = fract(hsh * 7.31);
        vec3 lamp = mix(vec3(1.0, 0.70, 0.40), vec3(0.88, 0.90, 1.0), hue * hue) * (0.55 + 0.45 * fract(hsh * 3.7));
        vec3 glowNear = lamp * litW * inX * inY;
        // A window's mean over the grid: 38 % lit, the wall's share of glass, an average lamp.
        vec3 glowFar = vec3(0.93, 0.74, 0.52) * 0.78 * 0.38 * ${onS} * share;
        outRgb += mix(glowNear, glowFar, far) * wallness;`
            : ''
        }
    }`;
}

/** The lit shader without shadow compensation (shadows off). */
export const LIT_INSTANCE_FS = litInstanceShader();

/** The shadow map's darkness in steps of this, so a new shader is compiled a few times a day. */
const SHADOW_D_STEP = 0.05;

/**
 * The trees' shader: the lit shader above with the leaf season (leaf-season.ts) on broad-leaf
 * crowns, which carry an alpha just under 1 as their mark (the trees are opaque, so alpha is
 * free). Each crown turns yellow, orange or red by its own tone, a little before or after its
 * neighbours; as the leaves go it fades to grey-brown twigs and thins to a screen-door, densest
 * across the crown's middle and feathered at its edge, so a bare crown reads as the see-through
 * haze of branches it is (its shadow thins with it).
 * Conifers and trunks are untouched. With `deciduous` under 1 (the south's eucalypts, the
 * Mediterranean's holm oaks) only that share of the broad-leaf crowns, picked by their tone,
 * takes the season, and takes all of it (`leafOn` / `autumn` are then a deciduous crown's own,
 * `deciduousCrown`); the rest stay in summer leaf.
 */
export function treeFragmentShader(
  leafOn: number,
  autumn: number,
  shadowD = 1,
  shadowMaxM = 0,
  deciduous = 1,
  directShare = 1,
  skyLift = 1,
  snow = 0,
  wet = 0,
): string {
  // Which crowns are deciduous: a hash of each crown's tone, so a crown keeps its kind.
  const pick = deciduous >= 1 ? '' : ` && fract(h * 11.1) < ${deciduous.toFixed(3)}`;
  const season = `
    float tone = clamp((v_color.g - 0.27) / 0.12, 0.0, 1.0);
    float h = fract(tone * 17.3 + v_color.r * 31.0);
    if (v_color.a < 0.995${pick}) {
        vec3 fall = h < 0.38 ? vec3(0.56, 0.44, 0.09) : (h < 0.72 ? vec3(0.60, 0.28, 0.07) : vec3(0.44, 0.11, 0.06));
        float turn = clamp(${autumn.toFixed(3)} * 1.35 - 0.35 * fract(h * 7.7), 0.0, 1.0);
        color.rgb = mix(color.rgb, czm_gammaCorrect(vec4(fall * (0.85 + 0.3 * fract(h * 5.3)), 1.0)).rgb, turn);
        float leaves = clamp(${leafOn.toFixed(3)} * 1.3 - 0.3 * fract(h * 3.3), 0.0, 1.0);
        if (leaves < 1.0) {
            color.rgb = mix(czm_gammaCorrect(vec4(0.30, 0.26, 0.22, 1.0)).rgb, color.rgb, leaves);
            // Twigs are densest where the line of sight crosses most of the crown (its middle)
            // and thin out to a feathered edge; from afar a white-noise dither, which reads as
            // twigs where a regular pattern read as netting (V&V: Boston Common in January), but
            // near the eye that dither sparkled and swam as a grain (V&V: Seattle in November),
            // so there the twigs are knots fixed to the tree.
            float facing = abs(dot(normalize(v_normalEC), normalize(-v_positionEC)));
            float keep = leaves + (1.0 - leaves) * (0.08 + 0.55 * facing * facing);
            float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
            // Near the eye the twigs are the tree's own (FOLIAGE_GLSL's twigTex), not the screen's.
            if (mix(dither, twigTex, twigSeen) > keep) discard;
        }
        color.a = 1.0;
    }`;
  const anchor = '    vec4 color = czm_gammaCorrect(v_color);';
  // Crowns hold snow only in patches (it sifts through and slides off the branches).
  return litInstanceShader(shadowD, shadowMaxM, false, directShare, skyLift, 0, snow * 0.55, wet)
    .replace(anchor, anchor + FOLIAGE_GLSL + season + FOLIAGE_TONE_GLSL)
    .replace('void main()', `${FOLIAGE_NOISE_GLSL}\nvoid main()`);
}

/**
 * A crown is foliage, not a smooth green ball. Two noises fixed to the ground - leaf clumps
 * 1.6 m across and leaves 0.4 m across - give it three things. Relief: the clumps stand some
 * 0.6 m proud of the gaps between them and the light takes each by the way it faces, so a
 * crown has lit clumps and shaded hollows on its sunny side and catches the sky on the clumps'
 * tops in shade (and lying snow settles on those tops). An outline: toward the crown's limb
 * the thinner clumps are cut away, so its edge runs in lobes a clump wide with the sky between
 * them instead of a drawn curve - never within the inner three fifths of its radius, where a
 * crown is not seen through, and always in its last few hundredths, where the surface is seen
 * edge-on and the noise on it would be drawn out into arcs. And tone: the clumps a little
 * lighter and yellower, the gaps darker. Each noise fades to its mean as a pixel grows past
 * its cells (a far wood does not shimmer; its crowns are smooth with a trimmed, even outline).
 * Crowns only - the instance's own colour is green before the season turns it, a trunk's is
 * bark - and their shadows stay the whole crown's.
 *
 * A conifer's cone (the crowns without the broad-leaf mark) carries its boughs in tiers 1.3 m
 * apart, their heights swayed by the clumps: each a skirt, wide at its foot where it turns up
 * to the light, drawn in toward its top in the shade of the skirt above - a fir's saw-edged
 * outline and banded flank. A round crown's cut would eat a cone's side whole (along a cone's
 * limb the facing does not change with height), so the cone keeps to within a few hundredths
 * of its edge. The tiers fade as a pixel nears half of one, the mean brightness kept.
 *
 * The noise is laid in the primitive's own frame from the camera's position as Cesium splits
 * it (the low part, exact, plus the fragment's offset from the eye), wrapped every 51.2 m,
 * which the high part's 65,536 m steps are multiples of: fixed to the ground wherever the
 * camera is. The relief is taken from the noise's screen-space derivatives (Mikkelsen's bump
 * mapping of unparametrised surfaces), all of them read before the outline's discard.
 * ASCII only.
 */
export const FOLIAGE_NOISE_GLSL = `
float lmLeafHash(vec3 c)
{
    c = fract(c * vec3(0.1031, 0.1030, 0.0973));
    c += dot(c, c.yxz + 33.33);
    return fract((c.x + c.y) * c.z);
}
// Value noise on cells that wrap every n.
float lmLeafNoise(vec3 p, float n)
{
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(lmLeafHash(mod(i, n)), lmLeafHash(mod(i + vec3(1.0, 0.0, 0.0), n)), f.x);
    float b = mix(lmLeafHash(mod(i + vec3(0.0, 1.0, 0.0), n)), lmLeafHash(mod(i + vec3(1.0, 1.0, 0.0), n)), f.x);
    float c = mix(lmLeafHash(mod(i + vec3(0.0, 0.0, 1.0), n)), lmLeafHash(mod(i + vec3(1.0, 0.0, 1.0), n)), f.x);
    float d = mix(lmLeafHash(mod(i + vec3(0.0, 1.0, 1.0), n)), lmLeafHash(mod(i + vec3(1.0, 1.0, 1.0), n)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}`;

/** The crown's shape - relief and outline - before the season: it sets `leafTex`. */
export const FOLIAGE_GLSL = `
    float leafTex = 0.5;
    float leafShade = 1.0;
    float twigTex = 0.5;
    float twigSeen = 0.0;
    if (v_color.g > v_color.r + 0.01) {
        vec3 leafRel = (czm_inverseModelView * vec4(v_positionEC, 0.0)).xyz;
        float leafPx = max(length(dFdx(leafRel)), length(dFdy(leafRel)));
        vec3 leafP = mod(czm_encodedCameraPositionMCLow + leafRel, 51.2);
        float clumpSeen = 1.0 - smoothstep(0.5, 1.6, leafPx);
        float leafSeen = 1.0 - smoothstep(0.12, 0.4, leafPx);
        float clumpTex = (lmLeafNoise(leafP / 1.6, 32.0) - 0.5) * clumpSeen;
        float fineTex = (lmLeafNoise(leafP / 0.4 + 7.0, 128.0) - 0.5) * leafSeen;
        leafTex = 0.5 + 0.6 * clumpTex + 0.4 * fineTex;
        // Twigs for a bare crown: knots of them 0.2 m and 0.8 m across, fixed to the tree, so
        // a crown near the eye thins to a still tangle rather than a sparkle (spread out from
        // the noise's bunching about its mean to nearly even, as the dither it stands in for).
        twigSeen = 1.0 - smoothstep(0.03, 0.09, leafPx);
        twigTex = smoothstep(0.22, 0.78, 0.6 * lmLeafNoise(leafP / 0.2 + 3.0, 256.0) + 0.4 * lmLeafNoise(leafP / 0.8 + 5.0, 64.0));
        // The relief, in metres, and the slope it gives the surface.
        float leafH = 2.0 * clumpTex + 0.2 * fineTex;
        vec3 leafDx = dFdx(v_positionEC);
        vec3 leafDy = dFdy(v_positionEC);
        vec3 leafR1 = cross(leafDy, normalEC);
        vec3 leafR2 = cross(normalEC, leafDx);
        float leafDet = dot(leafDx, leafR1);
        vec3 leafN = abs(leafDet) * normalEC
            - sign(leafDet) * (dFdx(leafH) * leafR1 + dFdy(leafH) * leafR2);
        // The outline: a crown is whole where it faces the eye (to 0.6 of its radius at the
        // least), gone at its very limb (past 0.97), and between them the clumps decide. The
        // facing is signed: a crown is a coarse mesh, and along its silhouette a face turned
        // to the eye can carry a smoothed normal turned away - that is limb too, not crown.
        float leafFacing = dot(normalEC, normalize(-v_positionEC));
        float leafCut = clamp(0.42 - 0.9 * clumpTex - 0.3 * fineTex, 0.24, 0.8);
        if (v_color.a > 0.995) {
            // A conifer (the broad-leaf crowns carry their mark in the alpha): boughs in tiers
            // 1.3 m apart up the cone, their heights swayed by the clumps. Each tier is a skirt:
            // wide at its foot, where it turns up to the light, drawn in toward its top, which
            // lies in the shade of the skirt above. So the cone's edge is a saw's.
            vec3 leafUpEC = normalize((czm_view * vec4(normalize((czm_inverseView * vec4(v_positionEC, 1.0)).xyz), 0.0)).xyz);
            float tierSeen = 1.0 - smoothstep(0.26, 0.59, leafPx);
            float tier = fract((czm_eyeHeight + dot(v_positionEC, leafUpEC)) / 1.3 + 0.9 * clumpTex);
            leafCut = clamp(0.16 + 0.38 * (tier - 0.35) * tierSeen - 0.5 * clumpTex - 0.3 * fineTex, 0.10, 0.8);
            leafN += abs(leafDet) * (0.5 - tier) * 1.6 * tierSeen
                * (leafUpEC - dot(leafUpEC, normalEC) * normalEC);
            leafShade = 1.0 + (0.12 - 0.45 * smoothstep(0.45, 1.0, tier)) * tierSeen;
        }
        if (leafFacing < leafCut) discard;
        float leafN2 = dot(leafN, leafN);
        if (leafN2 > 0.0) normalEC = leafN * inversesqrt(leafN2);
    }`;

/** The crown's tone, after the season has coloured it. */
export const FOLIAGE_TONE_GLSL = `
    if (v_color.g > v_color.r + 0.01) {
        color.rgb *= (0.70 + 0.60 * leafTex) * leafShade;
        color.rgb = mix(color.rgb, color.rgb * vec3(1.12, 1.08, 0.85), smoothstep(0.55, 0.9, leafTex));
    }`;

/**
 * How far a trunk runs below the finest terrain's ground. The globe draws coarser terrain until
 * it refines, and keeps it coarse some way off: within 800 m of the eye at Tromso it stood up to
 * 6 m off the finest, so trees on the low side hung over the drawn ground on a gap - the
 * "stray crowns" seen on arrival. A trunk sunk this far still meets the ground there.
 */
const TRUNK_SINK_M = 4;

/** The ids of a tree's parts after its number (`treeInstances`). */
const TREE_PARTS = [
  't',
  'c',
  'c1',
  'c2',
  'c3',
  'b0',
  'b1',
  'b2',
  'f0',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
] as const;

/** Broad-leaf crowns' alpha: the mark `treeFragmentShader` looks for. */
const BROADLEAF_ALPHA = 0.99;

/** Trees described per frame (their geometry is built in Cesium's workers). */
const TREE_SLICE = 1500;
/** Trees per tile whose ground is checked against the terrain drawn (`groundCaughtUp`). */
const TREE_GROUND_SAMPLES = 12;
/** The longest a tile's trees wait for the terrain drawn under them to catch up. */
const TREE_GROUND_WAIT_MS = 30_000;

/** A tree's ground (from the finest terrain), the terrain drawn there now, and its distance. */
export interface TreeGroundSample {
  groundM: number;
  drawnM: number | undefined;
  distanceM: number;
}

/**
 * Whether the terrain drawn has caught up with the ground a tile's trees stand on: three in
 * four of the sampled trees have terrain drawn under them within 3 m, plus 4 m a kilometre
 * (a far tile is drawn at a coarser level for good, and a few metres there do not show).
 * Each tree stands on the terrain's finest tiles (sampleTerrainMostDetailed); on arrival the
 * globe draws coarse ones, which over a hilly place can lie tens of metres under a slope, and
 * a wood stood out over the town as dark crowns hung in the sky until they refined (V&V:
 * Tromsø on arrival).
 */
export function groundCaughtUp(samples: readonly TreeGroundSample[]): boolean {
  if (samples.length === 0) return true;
  let close = 0;
  for (const t of samples) {
    if (t.drawnM === undefined) continue;
    if (Math.abs(t.drawnM - t.groundM) <= 3 + 0.004 * t.distanceM) close++;
  }
  return close >= 0.75 * samples.length;
}

interface TileState {
  key: string;
  x: number;
  y: number;
  primitives: Cesium.Primitive[];
  cancelled: boolean;
  done: Promise<void>;
  /** Every building and the trees (near), or only the skyline's tall buildings (far). */
  near: boolean;
  /** Each tree's primitive, instance ids (trunk, crown) and base, to hide the ones at the eye. */
  trees: { prim: Cesium.Primitive; id: number; base: Cesium.Cartesian3 }[];
  /** The tile's building footprints once read (empty: none there); null until then. */
  footprints: readonly BuildingFootprint[] | null;
  /** The tile's bridge decks (near tiles only), once read. */
  bridges: readonly BridgeLine[];
}

const boxes = new WeakMap<BuildingFootprint, [number, number, number, number]>();

/** A footprint's [west, south, east, north] in degrees, worked out once. */
function footprintBox(b: BuildingFootprint): [number, number, number, number] {
  let box = boxes.get(b);
  if (!box) {
    box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of b.outer) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
    boxes.set(b, box);
  }
  return box;
}

/**
 * A tile's footprints bucketed on a grid, so a point query tests the few near it: a dense tile
 * holds 10,000-20,000 (Kyoto), and the horizon asks about thousands of points (0.9 ms a query
 * when every footprint's box was tested).
 */
interface FootprintGrid {
  west: number;
  south: number;
  cellLon: number;
  cellLat: number;
  cells: Map<number, BuildingFootprint[]>;
}

const GRID_N = 64;
/** Degrees a footprint's box is widened by when bucketed: covers the 2.5 m reach to 83 deg. */
const GRID_PAD_DEG = 2e-4;
const grids = new WeakMap<readonly BuildingFootprint[], FootprintGrid>();

function footprintGrid(fp: readonly BuildingFootprint[]): FootprintGrid {
  let grid = grids.get(fp);
  if (grid) return grid;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const b of fp) {
    const box = footprintBox(b);
    west = Math.min(west, box[0]);
    south = Math.min(south, box[1]);
    east = Math.max(east, box[2]);
    north = Math.max(north, box[3]);
  }
  west -= GRID_PAD_DEG;
  south -= GRID_PAD_DEG;
  const cellLon = Math.max(1e-9, (east + GRID_PAD_DEG - west) / GRID_N);
  const cellLat = Math.max(1e-9, (north + GRID_PAD_DEG - south) / GRID_N);
  const cells = new Map<number, BuildingFootprint[]>();
  const clampCell = (v: number) => Math.max(0, Math.min(GRID_N - 1, Math.floor(v)));
  for (const b of fp) {
    const box = footprintBox(b);
    const x0 = clampCell((box[0] - GRID_PAD_DEG - west) / cellLon);
    const x1 = clampCell((box[2] + GRID_PAD_DEG - west) / cellLon);
    const y0 = clampCell((box[1] - GRID_PAD_DEG - south) / cellLat);
    const y1 = clampCell((box[3] + GRID_PAD_DEG - south) / cellLat);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = y * GRID_N + x;
        const list = cells.get(k);
        if (list) list.push(b);
        else cells.set(k, [b]);
      }
  }
  grid = { west, south, cellLon, cellLat, cells };
  grids.set(fp, grid);
  return grid;
}

/** The footprints whose padded box may hold [lon, lat] (none outside the tile's grid). */
function footprintsNear(fp: readonly BuildingFootprint[], lon: number, lat: number) {
  const g = footprintGrid(fp);
  const x = Math.floor((lon - g.west) / g.cellLon);
  const y = Math.floor((lat - g.south) / g.cellLat);
  if (x < 0 || y < 0 || x >= GRID_N || y >= GRID_N) return [];
  return g.cells.get(y * GRID_N + x) ?? [];
}

/** Whether [lon, lat] is within (dx, dy) degrees of any edge of a ring (scaled to a unit circle). */
function nearRing(
  ring: readonly (readonly [number, number])[],
  lon: number,
  lat: number,
  dx: number,
  dy: number,
): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j] as readonly [number, number];
    const [bx, by] = ring[i] as readonly [number, number];
    const ux = (bx - ax) / dx;
    const uy = (by - ay) / dy;
    const px = (lon - ax) / dx;
    const py = (lat - ay) / dy;
    const len2 = ux * ux + uy * uy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * ux + py * uy) / len2)) : 0;
    if (Math.hypot(px - t * ux, py - t * uy) <= 1) return true;
  }
  return false;
}

/** The ground at a footprint, metres above the ellipsoid. */
interface FootprintGround {
  centre: number;
  low: number;
  high: number;
}

/** Whether [lon, lat] is inside a ring (even-odd rule; the ring is not closed). */
function inRing(ring: readonly (readonly [number, number])[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as readonly [number, number];
    const [xj, yj] = ring[j] as readonly [number, number];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class OsmBuildingsLayer {
  private readonly C: CesiumModule;
  private readonly scene: Cesium.Scene;
  private readonly collection: Cesium.PrimitiveCollection;
  private readonly source: string;
  private readonly onError: (message: string, error: unknown) => void;
  private template: string | null = null;
  private templateJob: Promise<string | null> | null = null;
  private readonly tiles = new Map<string, TileState>();
  private readonly owned = new Set<unknown>();
  private readonly treePrims = new Set<Cesium.Primitive>();
  private treeIds = 0;
  /** Trees hidden because the eye stands in them: [primitive, id]. */
  private hiddenTrees: [Cesium.Primitive, number][] = [];
  private lastFocus: { lon: number; lat: number } | null = null;
  /** On the cheapest quality rungs: no trees drawn and no skyline ring. */
  private lean = false;
  /** The leaf season the trees are drawn in, and its shader (shared by every tree primitive). */
  private season = { leafOn: 1, autumn: 0, deciduous: 1 };
  private treeAppearance: Cesium.PerInstanceColorAppearance | null = null;
  /** The shadow map the shaders compensate for (`litInstanceShader`), and the buildings' shader. */
  private shadow = { d: 1, maxM: 0 };
  /** The direct share of the Sun's term (`setDirectShare`), in tenths. */
  private directShare = 1;
  /** The sky light's twilight lift (`setDirectShare`), in tenths. */
  private skyLift = 1;
  private buildingAppearance: Cesium.PerInstanceColorAppearance | null = null;
  /** How far the town's lights are on (`setCityLights`), in tenths. */
  private cityLights = 0;
  /** Lying snow on roofs and crowns, 0..1 in tenths (`setSnow`). */
  private snow = 0;
  /** Rain-wet surfaces, 0..1 in tenths (`setWet`). */
  private wet = 0;
  private readonly buildingPrims = new Set<Cesium.Primitive>();
  /**
   * Tree primitives hidden until the terrain drawn under them has caught up (`groundCaughtUp`):
   * a few of their trees' positions and grounds, and when the wait began.
   */
  private readonly treesWaiting = new Map<
    Cesium.Primitive,
    { at: Cesium.Cartographic[]; groundM: number[]; since: number }
  >();
  private treeWaitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Tiles' merged building primitives still being built in the workers (hidden). */
  private readonly merging = new Set<Cesium.Primitive>();
  private readonly removeGuard: () => void;
  /**
   * One slice of building or tree work per frame across every tile: tiles load side by side,
   * and their slices queued in the same frame made the walk into a dense city stutter.
   */
  private gate: Promise<void> = Promise.resolve();
  private destroyed = false;
  private failures = 0;

  constructor(
    C: CesiumModule,
    scene: Cesium.Scene,
    source: string,
    onError: (message: string, error: unknown) => void,
  ) {
    this.C = C;
    this.scene = scene;
    this.source = source;
    this.onError = onError;
    this.collection = new C.PrimitiveCollection();
    scene.primitives.add(this.collection);
    // A merge whose worker failed would throw from the primitives' update: drop it first.
    this.removeGuard = scene.preRender.addEventListener(() => {
      for (const p of this.merging)
        if (p.isDestroyed() || (p as unknown as { _error?: unknown })._error !== undefined) {
          this.merging.delete(p);
          if (!p.isDestroyed()) this.collection.remove(p);
        }
      this.releaseTrees();
    });
  }

  /**
   * Shows each waiting tile's trees once the terrain drawn under them has caught up, or after
   * TREE_GROUND_WAIT_MS. While any wait, the scene is asked to draw again a quarter-second on
   * (it draws on demand, and the check runs as it draws).
   */
  private releaseTrees(): void {
    if (this.treesWaiting.size === 0) return;
    const C = this.C;
    const globe = this.scene.globe as Cesium.Globe | undefined;
    const eye = this.scene.camera.positionWC;
    const now = performance.now();
    for (const [prim, wait] of this.treesWaiting) {
      if (prim.isDestroyed() || !this.treePrims.has(prim)) {
        this.treesWaiting.delete(prim);
        continue;
      }
      const samples = wait.at.map((c, i) => ({
        groundM: wait.groundM[i]!,
        drawnM: globe?.getHeight(c),
        distanceM: C.Cartesian3.distance(eye, C.Cartographic.toCartesian(c)),
      }));
      if (!globe || groundCaughtUp(samples) || now - wait.since > TREE_GROUND_WAIT_MS) {
        this.treesWaiting.delete(prim);
        prim.show = !this.lean;
        this.scene.requestRender();
      }
    }
    if (this.treesWaiting.size > 0 && this.treeWaitTimer === null) {
      this.treeWaitTimer = setTimeout(() => {
        this.treeWaitTimer = null;
        if (!this.destroyed) this.scene.requestRender();
      }, 250);
    }
  }

  /** Whether a picked primitive is one of these buildings. */
  owns(primitive: unknown): boolean {
    return this.owned.has(primitive);
  }

  /**
   * The trees' primitives: left out of height sampling (the horizon and a pin on a roof),
   * because the trees are a pattern of a wood, not mapped trees.
   */
  treePrimitives(): Cesium.Primitive[] {
    return [...this.treePrims];
  }

  /**
   * The quality rung's say: lean (Battery and Minimal) hides the trees and skips the skyline
   * ring, which a slow machine pays for most; the buildings near you stay.
   */
  setLean(lean: boolean): void {
    if (lean === this.lean) return;
    this.lean = lean;
    for (const p of this.treePrims) p.show = !lean && !this.treesWaiting.has(p);
    if (lean) for (const [key, state] of this.tiles) if (!state.near) this.drop(key, state);
    this.lastFocus = null; // the next update reconsiders the rings
    this.scene.requestRender();
  }

  /**
   * The leaf season (leaf-season.ts) for the broad-leaf trees. A new date swaps the trees'
   * shader; no tree is rebuilt. In steps of a twentieth: each new value is a shader compiled
   * (tens of milliseconds, a hitch while the date slider runs through autumn), and Cesium keeps
   * the programs it has built, so coarser steps also come back from its cache more often.
   */
  setSeason(leafOn: number, autumn: number, deciduous = 1): void {
    const q = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 20) / 20;
    // The averages become a deciduous crown's own season; the other crowns stay in leaf.
    const crown = deciduousCrown({ leafOn, autumn, deciduous });
    const next = { leafOn: q(crown.leafOn), autumn: q(crown.autumn), deciduous: q(deciduous) };
    if (
      next.leafOn === this.season.leafOn &&
      next.autumn === this.season.autumn &&
      next.deciduous === this.season.deciduous
    )
      return;
    this.season = next;
    this.treeAppearance = null;
    const appearance = this.appearanceForTrees();
    for (const p of this.treePrims) p.appearance = appearance;
    this.scene.requestRender();
  }

  /**
   * The shadow map's darkness (1 with shadows off) and distance, which the buildings' and trees'
   * shader divides out on faces turned from the Sun (`litInstanceShader`). Quantised, so the
   * shaders are swapped (never rebuilt geometry) a few times over a sunset.
   */
  setShadowMap(enabled: boolean, darkness: number, maximumDistanceM: number): void {
    const d = enabled
      ? Math.max(SHADOW_D_STEP, Math.round(darkness / SHADOW_D_STEP) * SHADOW_D_STEP)
      : 1;
    const maxM = enabled && d < 1 ? Math.round(maximumDistanceM) : 0;
    if (d === this.shadow.d && maxM === this.shadow.maxM) return;
    this.shadow = { d, maxM };
    this.treeAppearance = null;
    this.buildingAppearance = null;
    const trees = this.appearanceForTrees();
    for (const p of this.treePrims) p.appearance = trees;
    const buildings = this.appearanceForBuildings();
    for (const p of this.buildingPrims) p.appearance = buildings;
    this.scene.requestRender();
  }

  /**
   * How much of the light has a direction (the globe's directional share against a clear day's,
   * `globeLightSplit`): faces turned to the Sun stand out under a clear sky and hardly under an
   * overcast or in twilight. In tenths, so a shader is swapped a few times a day.
   */
  setDirectShare(share: number, skyLift = 1): void {
    const next = Math.round(Math.max(0, Math.min(1, share)) * 10) / 10;
    const lift = Math.round(Math.max(1, Math.min(3.4, skyLift)) * 10) / 10;
    if (next === this.directShare && lift === this.skyLift) return;
    this.directShare = next;
    this.skyLift = lift;
    this.treeAppearance = null;
    this.buildingAppearance = null;
    const trees = this.appearanceForTrees();
    for (const p of this.treePrims) p.appearance = trees;
    const buildings = this.appearanceForBuildings();
    for (const p of this.buildingPrims) p.appearance = buildings;
    this.scene.requestRender();
  }

  /**
   * How far the town's lights are on, 0..1 (`LightingParameters.cityLights`): lit windows in the
   * walls. In tenths, so the buildings' shader is swapped a few times through the dusk.
   */
  setCityLights(level: number): void {
    const next = Math.round(Math.max(0, Math.min(1, level)) * 10) / 10;
    if (next === this.cityLights) return;
    this.cityLights = next;
    this.buildingAppearance = null;
    const buildings = this.appearanceForBuildings();
    for (const p of this.buildingPrims) p.appearance = buildings;
    this.scene.requestRender();
  }

  /**
   * Lying snow, 0..1 (the ground texture's `snowCover`): white on roofs and the tops of crowns.
   * In tenths, so the shaders are swapped only as the season turns.
   */
  setSnow(level: number): void {
    const next = Math.round(Math.max(0, Math.min(1, level)) * 10) / 10;
    if (next === this.snow) return;
    this.snow = next;
    this.treeAppearance = null;
    this.buildingAppearance = null;
    const trees = this.appearanceForTrees();
    for (const p of this.treePrims) p.appearance = trees;
    const buildings = this.appearanceForBuildings();
    for (const p of this.buildingPrims) p.appearance = buildings;
    this.scene.requestRender();
  }

  /**
   * How wet the town is, 0..1 (the ground texture's `wet`): walls, roofs and leaves darkened
   * with the ground. In tenths, so the shaders are swapped only as the rain comes and goes.
   */
  setWet(level: number): void {
    const next = Math.round(Math.max(0, Math.min(1, level)) * 10) / 10;
    if (next === this.wet) return;
    this.wet = next;
    this.treeAppearance = null;
    this.buildingAppearance = null;
    const trees = this.appearanceForTrees();
    for (const p of this.treePrims) p.appearance = trees;
    const buildings = this.appearanceForBuildings();
    for (const p of this.buildingPrims) p.appearance = buildings;
    this.scene.requestRender();
  }

  private appearanceForTrees(): Cesium.PerInstanceColorAppearance {
    this.treeAppearance ??= new this.C.PerInstanceColorAppearance({
      flat: false,
      translucent: false,
      closed: true,
      fragmentShaderSource: treeFragmentShader(
        this.season.leafOn,
        this.season.autumn,
        this.shadow.d,
        this.shadow.maxM,
        this.season.deciduous,
        this.directShare,
        this.skyLift,
        this.snow,
        this.wet,
      ),
    });
    return this.treeAppearance;
  }

  private appearanceForBuildings(): Cesium.PerInstanceColorAppearance {
    this.buildingAppearance ??= new this.C.PerInstanceColorAppearance({
      flat: false,
      translucent: false,
      closed: true,
      fragmentShaderSource: litInstanceShader(
        this.shadow.d,
        this.shadow.maxM,
        true,
        this.directShare,
        this.skyLift,
        this.cityLights,
        this.snow,
        this.wet,
      ),
    });
    return this.buildingAppearance;
  }

  /**
   * Whether a mapped building stands at the point: true or false once its tile has been read
   * (near tiles hold every building, far ones only the tall), null while that is unknown.
   */
  hasBuildingAt(lon: number, lat: number): boolean | null {
    const t = lonLatToTile(BUILDING_TILE_ZOOM, lon, lat);
    const fp = this.tiles.get(`${t.x}/${t.y}`)?.footprints;
    if (!fp) return null;
    // Within the pick's own reach of a wall counts (the surface probe is 2 m wide, so a horizon
    // sample just outside a footprint can meet its wall); a box test first, then the ring.
    const mLat = 1 / 110_540;
    const mLon = 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const reach = 2.5;
    return footprintsNear(fp, lon, lat).some((b) => {
      const box = footprintBox(b);
      if (
        lon < box[0] - reach * mLon ||
        lon > box[2] + reach * mLon ||
        lat < box[1] - reach * mLat ||
        lat > box[3] + reach * mLat
      )
        return false;
      if (inRing(b.outer, lon, lat) && !b.holes.some((h) => inRing(h, lon, lat))) return true;
      return nearRing(b.outer, lon, lat, reach * mLon, reach * mLat);
    });
  }

  /** The mapped bridge deck under the point (near tiles, once read), or null. */
  bridgeAt(lon: number, lat: number): BridgeLine | null {
    const t = lonLatToTile(BUILDING_TILE_ZOOM, lon, lat);
    const state = this.tiles.get(`${t.x}/${t.y}`);
    return state ? bridgeAt(state.bridges, lon, lat) : null;
  }

  /** How many buildings' primitives are on the globe (0 until the first tile is drawn). */
  get primitiveCount(): number {
    return this.owned.size;
  }

  /**
   * Called as the camera moves: the focus is where you stand (the Viewpoint) or the ground
   * you look at (the map); `heightAboveM` is how far above it the camera is.
   */
  update(lon: number, lat: number, heightAboveM: number, force = false): void {
    if (this.destroyed) return;
    if (heightAboveM > MAX_LOAD_HEIGHT_M) return;
    if (this.lastFocus && !force) {
      const dx = (lon - this.lastFocus.lon) * 111_320 * Math.cos((lat * Math.PI) / 180);
      const dy = (lat - this.lastFocus.lat) * 111_320;
      if (Math.hypot(dx, dy) < 150) return;
    }
    this.lastFocus = { lon, lat };
    const near = buildingTilesAround(lon, lat, LOAD_RADIUS_M);
    const nearKeys = new Set(near.map((t) => `${t.x}/${t.y}`));
    const far = buildingTilesAround(lon, lat, this.lean ? LOAD_RADIUS_M : FAR_RADIUS_M).filter(
      (t) => !nearKeys.has(`${t.x}/${t.y}`),
    );
    const want = (t: { x: number; y: number }, full: boolean) => {
      const key = `${t.x}/${t.y}`;
      const have = this.tiles.get(key);
      if (have && (have.near || !full)) return;
      if (have) this.drop(key, have); // a skyline tile come near: load it in full
      const state: TileState = {
        key,
        x: t.x,
        y: t.y,
        primitives: [],
        cancelled: false,
        done: Promise.resolve(),
        near: full,
        trees: [],
        footprints: null,
        bridges: [],
      };
      this.tiles.set(key, state);
      state.done = this.load(state);
    };
    for (const t of near) want(t, true);
    for (const t of far) want(t, false);
    // Drop tiles left far behind.
    const centre = lonLatToTile(BUILDING_TILE_ZOOM, lon, lat);
    const tileM = (40_075_016 * Math.cos((lat * Math.PI) / 180)) / 2 ** BUILDING_TILE_ZOOM;
    for (const [key, state] of this.tiles) {
      const d = Math.hypot(state.x - centre.x, state.y - centre.y) * tileM;
      if (d > KEEP_RADIUS_M) this.drop(key, state);
    }
  }

  /**
   * Hides the trees whose trunk stands within `radiusM` of the eye: the woods are a pattern, so
   * one may grow exactly where you stand, and from inside a crown nothing else shows.
   */
  hideTreesNear(eye: Cesium.Cartesian3, radiusM = 9): void {
    const C = this.C;
    const show = (prim: Cesium.Primitive, id: number, on: boolean) => {
      if (prim.isDestroyed() || !prim.ready) return false;
      for (const part of TREE_PARTS) {
        const a = prim.getGeometryInstanceAttributes(`${id}${part}`) as
          { show?: unknown } | undefined;
        if (a) a.show = C.ShowGeometryInstanceAttribute.toValue(on);
      }
      return true;
    };
    // Only what changed: re-showing and hiding the same trees every half second rewrote the
    // primitives' per-instance attribute buffers each time, for nothing.
    const r2 = radiusM * radiusM;
    const near: [Cesium.Primitive, number][] = [];
    for (const state of this.tiles.values())
      for (const t of state.trees)
        if (C.Cartesian3.distanceSquared(t.base, eye) < r2) near.push([t.prim, t.id]);
    const isNear = new Set(near.map(([, id]) => id));
    const wasHidden = new Set(this.hiddenTrees.map(([, id]) => id));
    let changed = false;
    const kept: [Cesium.Primitive, number][] = [];
    for (const [prim, id] of this.hiddenTrees) {
      if (isNear.has(id) && !prim.isDestroyed()) kept.push([prim, id]);
      else if (show(prim, id, true)) changed = true;
    }
    for (const [prim, id] of near)
      if (!wasHidden.has(id) && show(prim, id, false)) {
        kept.push([prim, id]);
        changed = true;
      }
    this.hiddenTrees = kept;
    if (changed) this.scene.requestRender();
  }

  /**
   * Loads the buildings around a point and resolves once they are drawn (or failed): the
   * horizon's building pass waits on this so its first run already sees them.
   */
  async loadAround(lon: number, lat: number): Promise<void> {
    this.update(lon, lat, 0, true);
    const keys = buildingTilesAround(lon, lat, LOAD_RADIUS_M).map((t) => `${t.x}/${t.y}`);
    await Promise.all(keys.map((k) => this.tiles.get(k)?.done ?? Promise.resolve()));
  }

  private drop(key: string, state: TileState): void {
    state.cancelled = true;
    for (const p of state.primitives) {
      this.owned.delete(p);
      this.treePrims.delete(p);
      this.buildingPrims.delete(p);
      this.collection.remove(p); // destroys it
    }
    state.primitives = [];
    this.tiles.delete(key);
    this.scene.requestRender();
  }

  /** The vector tiles' XYZ template, once the TileJSON has answered (null if it cannot). */
  tileTemplate(): Promise<string | null> {
    return this.resolveTemplate();
  }

  private async resolveTemplate(): Promise<string | null> {
    if (this.template) return this.template;
    this.templateJob ??= (async () => {
      if (this.source.includes('{z}')) return this.source;
      const res = await fetch(this.source);
      if (!res.ok) throw new Error(`TileJSON ${res.status}`);
      const json = (await res.json()) as { tiles?: unknown };
      const first: unknown = Array.isArray(json.tiles) ? (json.tiles as unknown[])[0] : undefined;
      if (typeof first !== 'string') throw new Error('TileJSON has no tile template');
      return first;
    })().catch((error: unknown) => {
      this.templateJob = null; // try again on the next move
      this.report(error);
      return null;
    });
    this.template = await this.templateJob;
    return this.template;
  }

  /** Waits for this tile's turn: the frame after the previous slice of any tile. */
  private nextSlot(): Promise<void> {
    const turn = this.gate.then(nextFrame);
    this.gate = turn;
    return turn;
  }

  private report(error: unknown): void {
    // One notice, not one per tile.
    if (this.failures++ === 0) this.onError('Buildings could not be loaded here', error);
  }

  private async load(state: TileState): Promise<void> {
    try {
      const template = await this.resolveTemplate();
      if (!template || state.cancelled || this.destroyed) {
        if (!template) this.tiles.delete(state.key);
        return;
      }
      const res = await fetch(tileUrl(template, BUILDING_TILE_ZOOM, state.x, state.y));
      if (res.status === 404 || res.status === 204) {
        state.footprints = []; // no data there (open sea)
        return;
      }
      if (!res.ok) throw new Error(`building tile ${state.key}: HTTP ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      if (state.cancelled || this.destroyed) return;
      // Decoded a frame's budget at a time: a dense city tile took a tenth of a second or more
      // of one frame to read, a visible stall while panning.
      const steps = buildingsFromTileSteps(data, BUILDING_TILE_ZOOM, state.x, state.y);
      let all: BuildingFootprint[] | null = null;
      while (!all) {
        // Every slice in its turn, the first too: a burst of tiles landing together must not
        // decode one slice each in the same frame.
        await this.nextSlot();
        if (state.cancelled || this.destroyed) return;
        const started = performance.now();
        let step = steps.next();
        while (!step.done && performance.now() - started < SLICE_BUDGET_MS) step = steps.next();
        if (step.done) all = step.value;
      }
      const buildings = state.near ? all : all.filter((b) => b.heightM >= FAR_MIN_HEIGHT_M);
      state.footprints = buildings;
      // The bridges (the transport layer) and the trees (land cover) each in a frame of their
      // own, after the buildings'.
      if (state.near) {
        await this.nextSlot();
        if (state.cancelled || this.destroyed) return;
        state.bridges = bridgeLinesFromTile(data, BUILDING_TILE_ZOOM, state.x, state.y);
        await this.nextSlot();
        if (state.cancelled || this.destroyed) return;
      }
      const [, tileLat] = tilePointToLonLat(BUILDING_TILE_ZOOM, state.x, state.y, 1, 0.5, 0.5);
      const trees = state.near
        ? treesFromTile(data, BUILDING_TILE_ZOOM, state.x, state.y, tileLat)
        : [];

      if (buildings.length > 0) {
        // The ground under each building, from the terrain's finest tiles: at its centre and,
        // on a slope, the lowest and highest of up to six of its corners.
        const grounds = await this.footprintGrounds(buildings);
        if (state.cancelled || this.destroyed) return;
        // First the whole tile at once in Cesium's workers: no triangulation on the main thread,
        // and a dense tile (Kyoto's hold 10,000-20,000 footprints) shows in seconds instead of
        // a slice a frame for hundreds of frames. A footprint the workers cannot triangulate
        // fails the whole primitive; then the tile is built in checked slices as before.
        const whole = await this.describeAll(state, buildings, grounds);
        if (!whole) return;
        const built = whole.length > 0 && (await this.mergeSlices(state, [], whole)) !== null;
        if (state.cancelled || this.destroyed) return;
        let i = built || whole.length === 0 ? buildings.length : 0;
        const slices: Cesium.Primitive[] = [];
        const again: Cesium.GeometryInstance[] = [];
        while (i < buildings.length) {
          await this.nextSlot();
          if (state.cancelled || this.destroyed) return;
          const slice = this.buildSlice(buildings, grounds, i, again);
          this.adopt(state, slice.primitive);
          if (slice.primitive) slices.push(slice.primitive);
          i = slice.next;
        }
        if (slices.length > 1) void this.mergeSlices(state, slices, again);
        // The houses' pitched roofs over the walls just built (near tiles: the far ring keeps
        // only tall buildings, and no house is tall).
        if (state.near) await this.loadRoofs(state, buildings, grounds);
        if (state.cancelled || this.destroyed) return;
      }

      // The trees after the buildings, not awaited: `done` (which the horizon's building pass
      // waits on) need not wait for them, and the horizon leaves them out anyway.
      if (trees.length > 0) void this.loadTrees(state, trees);
    } catch (error) {
      this.tiles.delete(state.key);
      this.report(error);
    }
  }

  /**
   * A tile's trees as one primitive in the workers, described TREE_SLICE trees a frame. Tree
   * shapes are Cesium's own cylinders and ellipsoids, which do not fail; if the build does
   * anyway (or times out) the tile goes without trees - they are a pattern, and slices built
   * the same way would fail the same way, outside the guard.
   */
  private async loadTrees(state: TileState, trees: readonly TreeSpot[]): Promise<void> {
    try {
      const sampled = await this.groundHeightsOrNull(trees.map((t) => [t.lon, t.lat]));
      if (state.cancelled || this.destroyed) return;
      const grounds = sampled.map((h) => h ?? 0);
      const all: Cesium.GeometryInstance[] = [];
      const records: { id: number; base: Cesium.Cartesian3 }[] = [];
      for (let i = 0; i < trees.length; i += TREE_SLICE) {
        await this.nextSlot();
        if (state.cancelled || this.destroyed) return;
        this.treeInstances(
          trees.slice(i, i + TREE_SLICE),
          grounds.slice(i, i + TREE_SLICE),
          records,
          all,
        );
      }
      if (all.length === 0) return;
      const whole = await this.mergeSlices(state, [], all, true);
      if (!whole) return;
      for (const r of records) state.trees.push({ prim: whole, ...r });
      // A few of the trees, spread through the tile, to check the terrain drawn against.
      const step = Math.max(1, Math.floor(trees.length / TREE_GROUND_SAMPLES));
      const at: Cesium.Cartographic[] = [];
      const groundM: number[] = [];
      for (let i = 0; i < trees.length && at.length < TREE_GROUND_SAMPLES; i += step) {
        const g = sampled[i];
        if (g === null || g === undefined) continue;
        at.push(this.C.Cartographic.fromDegrees(trees[i]!.lon, trees[i]!.lat));
        groundM.push(g);
      }
      if (at.length > 0) {
        whole.show = false;
        this.treesWaiting.set(whole, { at, groundM, since: performance.now() });
        this.releaseTrees();
      }
    } catch (error) {
      this.report(error);
    }
  }

  private adopt(state: TileState, primitive: Cesium.Primitive | null, tree = false): void {
    if (!primitive) return;
    if (tree) {
      this.treePrims.add(primitive);
      primitive.show = !this.lean;
    } else this.buildingPrims.add(primitive);
    state.primitives.push(primitive);
    this.owned.add(primitive);
    this.collection.add(primitive);
    this.scene.requestRender();
  }

  /**
   * Builds a tile's buildings (or trees) as one primitive in Cesium's workers and, once it is
   * ready, shows it in place of the slices drawn meanwhile, if any (same shapes, colours, ids
   * and shader); null when it failed, timed out or the tile went away.
   */
  private async mergeSlices(
    state: TileState,
    slices: readonly Cesium.Primitive[],
    instances: Cesium.GeometryInstance[],
    trees = false,
  ): Promise<Cesium.Primitive | null> {
    const C = this.C;
    const appearance = () => (trees ? this.appearanceForTrees() : this.appearanceForBuildings());
    const merged = new C.Primitive({
      geometryInstances: instances,
      appearance: appearance(),
      shadows: C.ShadowMode.ENABLED,
      asynchronous: true,
      releaseGeometryInstances: true,
      allowPicking: true,
    });
    merged.show = false; // Cesium builds a hidden primitive all the same
    this.merging.add(merged);
    this.collection.add(merged);
    const started = performance.now();
    const gone = () =>
      state.cancelled || this.destroyed || merged.isDestroyed() || !this.merging.has(merged);
    while (!merged.ready && !gone() && performance.now() - started < MERGE_TIMEOUT_MS) {
      this.scene.requestRender();
      await nextFrame();
    }
    const failed = gone() || !merged.ready;
    this.merging.delete(merged);
    if (failed) {
      if (!merged.isDestroyed() && !this.destroyed) this.collection.remove(merged);
      return null;
    }
    // The shader may have moved on (the Sun set, the season turned) while the workers built it.
    merged.appearance = appearance();
    merged.show = trees ? !this.lean : true;
    const replaced = new Set<Cesium.Primitive>(slices);
    for (const p of slices) {
      this.owned.delete(p);
      this.buildingPrims.delete(p);
      this.treePrims.delete(p);
      this.collection.remove(p); // destroys it
    }
    state.primitives = state.primitives.filter((q) => !replaced.has(q));
    state.primitives.push(merged);
    this.owned.add(merged);
    (trees ? this.treePrims : this.buildingPrims).add(merged);
    this.scene.requestRender();
    return merged;
  }

  /** The ground at each footprint: its centre, and the lowest and highest of its corners. */
  private async footprintGrounds(
    buildings: readonly BuildingFootprint[],
  ): Promise<FootprintGround[]> {
    const points: (readonly [number, number])[] = [];
    const spans: [number, number][] = [];
    for (const b of buildings) {
      const start = points.length;
      points.push(b.centre);
      const ring = b.outer;
      const step = Math.max(1, Math.ceil(ring.length / 6));
      for (let k = 0; k < ring.length; k += step) points.push(ring[k] as [number, number]);
      spans.push([start, points.length]);
    }
    const h = await this.groundHeightsOrNull(points);
    return spans.map(([a, z]) => {
      // A point the terrain could not answer is left out (0 would sink a wall to the ellipsoid).
      let centre = h[a] ?? null;
      for (let k = a + 1; centre === null && k < z; k++) centre = h[k] ?? null;
      const c = centre ?? 0;
      let low = c;
      let high = c;
      for (let k = a + 1; k < z; k++) {
        const v = h[k] ?? c;
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
      return { centre: c, low, high };
    });
  }

  /** The terrain's height at points, from its finest tiles (0, or null below, where it cannot say). */
  private async groundHeights(points: readonly (readonly [number, number])[]): Promise<number[]> {
    return (await this.groundHeightsOrNull(points)).map((h) => h ?? 0);
  }

  private async groundHeightsOrNull(
    points: readonly (readonly [number, number])[],
  ): Promise<(number | null)[]> {
    const missing = null;
    const C = this.C;
    const cartos = points.map(([lon, lat]) => C.Cartographic.fromDegrees(lon, lat));
    try {
      const sampled = await C.sampleTerrainMostDetailed(this.scene.terrainProvider, cartos);
      return sampled.map((c: Cesium.Cartographic) =>
        Number.isFinite(c.height) ? c.height : missing,
      );
    } catch {
      return cartos.map(() => missing);
    }
  }

  /**
   * Each tree, built by its form (`TreeForm`) and placed upright on the ground: plain shapes
   * from Cesium's own geometry, built in its workers; they cast shadows like the buildings.
   * - broadleaf: a trunk, and a crown that is not a ball on a stick - its footprint oval and
   *   turned, set a little off the trunk, its height and spread varied tree by tree; a park
   *   tree (standing alone, seen whole) gets two more lobes, so its outline is lumpy and its top
   *   uneven, as an oak's or a mango's is;
   * - conifer: a cone (the shader tiers its boughs); columnar: a narrow spire over a short
   *   bare trunk;
   * - umbrella: a short stout bole forking into three limbs under a deep, wide dome
   *   (monkeypod, rain tree, stone pine);
   * - ironwood (casuarina): a tall bole under four ragged tufts on their own branches;
   * - palm: a slim stem, leaning a little or a lot, a knot of frond bases, and seven fronds
   *   arching out and down.
   * Trunks thicken with height. Ids are the tree's number and a part (`TREE_PARTS`: `t` the
   * trunk, `c..c3` crowns, `b0..b2` limbs, `f0..f6` fronds), so single trees can be hidden
   * (`hideTreesNear`) by their attributes.
   */
  private treeInstances(
    trees: readonly TreeSpot[],
    grounds: readonly number[],
    record: { id: number; base: Cesium.Cartesian3 }[],
    out: Cesium.GeometryInstance[],
  ): void {
    const C = this.C;
    const vertexFormat = C.PerInstanceColorAppearance.VERTEX_FORMAT;
    const bark = C.ColorGeometryInstanceAttribute.fromColor(new C.Color(0.32, 0.25, 0.18, 1));
    const palmBark = C.ColorGeometryInstanceAttribute.fromColor(new C.Color(0.46, 0.41, 0.34, 1));
    // Fronds take the plain lit path (green no more than their red, so not the foliage cut,
    // which would eat a blade seen edge-on).
    // A sunlit coconut frond's olive, not a shadow's.
    const frond = C.ColorGeometryInstanceAttribute.fromColor(new C.Color(0.36, 0.37, 0.14, 1));
    const shown = () => new C.ShowGeometryInstanceAttribute(true);
    trees.forEach((t, i) => {
      const ground = (grounds[i] ?? 0) - 0.3;
      const base = C.Cartesian3.fromDegrees(t.lon, t.lat, ground);
      const enu = C.Transforms.eastNorthUpToFixedFrame(base);
      const id = ++this.treeIds;
      record.push({ id, base });
      const s = t.shape;
      // A local frame: at (east, north, up) metres, turned `turn` about the vertical.
      const at = (e: number, n: number, up: number, turn = 0) =>
        C.Matrix4.multiply(
          enu,
          C.Matrix4.fromRotationTranslation(
            C.Matrix3.fromRotationZ(turn),
            new C.Cartesian3(e, n, up),
            new C.Matrix4(),
          ),
          new C.Matrix4(),
        );
      // A trunk runs TRUNK_SINK_M into the ground, so a tree still meets the ground the globe
      // draws where that is coarser and lower than the finest terrain it stands on.
      const trunk = (length: number, top: number, bottom: number, colour = bark) =>
        out.push(
          new C.GeometryInstance({
            geometry: new C.CylinderGeometry({
              length: length + TRUNK_SINK_M,
              topRadius: top,
              bottomRadius: bottom,
              slices: 5,
              vertexFormat,
            }),
            modelMatrix: at(0, 0, (length - TRUNK_SINK_M) / 2),
            id: `${id}t`,
            attributes: { color: colour, show: shown() },
          }),
        );
      // A limb: a tapering cylinder from (0, 0, fromUp) out to (e, n, toUp).
      const limb = (
        part: string,
        fromUp: number,
        e: number,
        n: number,
        toUp: number,
        radius: number,
        colour = bark,
      ) => {
        const flat = Math.hypot(e, n);
        const length = Math.hypot(flat, toUp - fromUp);
        const tilt = Math.atan2(flat, toUp - fromUp);
        const rot = C.Matrix3.multiply(
          C.Matrix3.fromRotationZ(Math.atan2(n, e)),
          C.Matrix3.fromRotationY(tilt),
          new C.Matrix3(),
        );
        out.push(
          new C.GeometryInstance({
            geometry: new C.CylinderGeometry({
              length,
              topRadius: radius * 0.6,
              bottomRadius: radius,
              slices: 5,
              vertexFormat,
            }),
            modelMatrix: C.Matrix4.multiply(
              enu,
              C.Matrix4.fromRotationTranslation(
                rot,
                new C.Cartesian3(e / 2, n / 2, (fromUp + toUp) / 2),
                new C.Matrix4(),
              ),
              new C.Matrix4(),
            ),
            id: `${id}${part}`,
            attributes: { color: colour, show: shown() },
          }),
        );
      };
      // A trunk thickens with the tree's height (a 15 m tree's is near a metre across).
      const girth = 0.14 + 0.02 * t.heightM;
      const g = 0.27 + 0.12 * t.tone;
      const broadLeaf = C.ColorGeometryInstanceAttribute.fromColor(
        new C.Color(0.2 + 0.08 * t.tone, g, 0.12 + 0.03 * t.tone, BROADLEAF_ALPHA),
      );
      const needle = C.ColorGeometryInstanceAttribute.fromColor(
        t.form === 'columnar'
          ? new C.Color(0.1 + 0.04 * t.tone, g - 0.08, 0.12, 1)
          : new C.Color(0.12 + 0.05 * t.tone, g - 0.05, 0.13, 1),
      );
      const blob = (
        part: string,
        rx: number,
        ry: number,
        rz: number,
        e: number,
        n: number,
        up: number,
        turn: number,
        colour = broadLeaf,
        stacks = 5,
        slices = 7,
      ) =>
        out.push(
          new C.GeometryInstance({
            geometry: new C.EllipsoidGeometry({
              radii: new C.Cartesian3(rx, ry, rz),
              stackPartitions: stacks,
              slicePartitions: slices,
              vertexFormat,
            }),
            modelMatrix: at(e, n, up, turn),
            id: `${id}${part}`,
            attributes: { color: colour, show: shown() },
          }),
        );
      const turn = s * Math.PI * 2;
      if (t.form === 'conifer' || t.form === 'columnar') {
        const crownH = t.heightM * (t.form === 'columnar' ? 0.88 : 0.8);
        const trunkH = t.heightM - crownH + 0.5;
        trunk(trunkH, 0.18, 0.25);
        out.push(
          new C.GeometryInstance({
            geometry: new C.CylinderGeometry({
              length: crownH,
              topRadius: 0,
              bottomRadius: t.radiusM,
              slices: t.form === 'columnar' ? 6 : 7,
              vertexFormat,
            }),
            modelMatrix: at(0, 0, t.heightM - crownH / 2),
            id: `${id}c`,
            attributes: { color: needle, show: shown() },
          }),
        );
        return;
      }
      if (t.form === 'palm') {
        // A coconut palm's stem is seldom plumb: it leans a little or a lot, most often out
        // toward open light; the crown sits on its top, wherever that lands.
        const top = t.heightM - 0.6;
        const lean = 0.04 + 0.2 * s * s;
        const lx = Math.cos(turn * 2.3) * Math.sin(lean) * top;
        const ly = Math.sin(turn * 2.3) * Math.sin(lean) * top;
        limb('t', -TRUNK_SINK_M, lx, ly, top, 0.2, palmBark);
        blob('c', 0.55, 0.55, 0.7, lx, ly, top, 0, frond, 4, 6);
        const len = t.radiusM;
        // A wood's palms, many and seen among the canopy, get five fronds; a park's seven.
        const fronds = t.park ? 7 : 5;
        for (let k = 0; k < fronds; k++) {
          const a = turn + (k * 2 * Math.PI) / fronds + 0.3 * Math.sin(k * 2.1 + s * 9);
          // Arching out and down: the older, lower fronds droop most.
          const droop = 0.25 + (0.35 * ((k * 3) % fronds)) / fronds;
          const m = C.Matrix4.multiply(
            at(lx, ly, top, a),
            C.Matrix4.fromRotationTranslation(
              C.Matrix3.fromRotationY(droop),
              new C.Cartesian3(Math.cos(droop) * len * 0.5, 0, -Math.sin(droop) * len * 0.5),
              new C.Matrix4(),
            ),
            new C.Matrix4(),
          );
          out.push(
            new C.GeometryInstance({
              geometry: new C.EllipsoidGeometry({
                radii: new C.Cartesian3(len * 0.5, 0.75, 0.1),
                stackPartitions: 3,
                slicePartitions: 6,
                vertexFormat,
              }),
              modelMatrix: m,
              id: `${id}f${k}`,
              attributes: { color: frond, show: shown() },
            }),
          );
        }
        return;
      }
      if (t.form === 'ironwood') {
        // A casuarina: a tall straight bole and an open, ragged crown of drooping grey-green
        // needles - four tufts, each smaller and higher, thrown out to different sides on
        // their own branches (the shader's tiers and outline cut break them up).
        const iron = C.ColorGeometryInstanceAttribute.fromColor(
          new C.Color(0.2 + 0.04 * t.tone, 0.26 + 0.05 * t.tone, 0.21, 1),
        );
        const crownBase = t.heightM * (0.25 + 0.08 * s);
        const crownH = t.heightM - crownBase;
        trunk(crownBase + crownH * 0.75, girth * 0.55, girth);
        const r = t.radiusM;
        // Four tufts up the bole, each thrown to its own side on a branch and overlapping the
        // next only a little: a ragged, uneven outline, never a stack of discs.
        const tufts: [string, number, number, number, number][] = [
          // part, height in the crown (centre), half-height, width (x r), reach (x r)
          ['c', 0.28, 0.24, 0.6, 0.5],
          ['c1', 0.5, 0.24, 0.55, 0.45],
          ['c2', 0.7, 0.2, 0.45, 0.3],
          ['c3', 0.88, 0.14, 0.3, 0.1],
        ];
        tufts.forEach(([part, up, half, wide, reach], k) => {
          const a = turn + k * 2.1;
          const e = Math.cos(a) * r * reach;
          const n = Math.sin(a) * r * reach;
          const z = crownBase + crownH * up;
          blob(part, r * wide, r * wide * (0.75 + 0.25 * s), crownH * half, e, n, z, a, iron, 5, 7);
          if (k < 3) limb(`b${k}`, z - crownH * 0.2, e * 0.8, n * 0.8, z, girth * 0.35);
        });
        return;
      }
      if (t.form === 'umbrella') {
        // A monkeypod or a rain tree: a short stout bole forking low into three great limbs
        // that hold up a deep, wide dome - not a disc on a pole.
        const crownH = t.heightM * (0.5 + 0.1 * s);
        const crownBase = t.heightM - crownH;
        const fork = Math.max(2, crownBase * 0.55);
        trunk(fork + 0.4, girth * 1.1, girth * 1.5);
        for (let k = 0; k < 3; k++) {
          const a = turn + (k * 2 * Math.PI) / 3 + 0.4 * s;
          const reach = t.radiusM * (0.35 + 0.1 * k * s);
          limb(
            `b${k}`,
            fork,
            Math.cos(a) * reach,
            Math.sin(a) * reach,
            crownBase + crownH * 0.3,
            girth * 0.8,
          );
        }
        // The dome: flatter below than above, so its centre sits low in the crown.
        blob(
          'c',
          t.radiusM,
          t.radiusM * (0.8 + 0.2 * s),
          crownH * 0.55,
          0,
          0,
          crownBase + crownH * 0.45,
          turn,
          broadLeaf,
          6,
          9,
        );
        if (t.park) {
          const a = turn + 1.3;
          blob(
            'c1',
            t.radiusM * 0.55,
            t.radiusM * 0.5,
            crownH * 0.4,
            Math.cos(a) * t.radiusM * 0.5,
            Math.sin(a) * t.radiusM * 0.5,
            crownBase + crownH * 0.55,
            a,
          );
        }
        return;
      }
      // Broad-leaf: an oval footprint, turned, set off the trunk, its height its own.
      const crownH = t.heightM * (0.5 + 0.15 * s);
      const crownBase = t.heightM - crownH;
      const r = t.radiusM;
      const off = 0.18 * r;
      const ox = Math.cos(turn * 1.7) * off;
      const oy = Math.sin(turn * 1.7) * off;
      trunk(crownBase + crownH * 0.35, girth * 0.7, girth);
      if (!t.park) {
        blob(
          'c',
          r * (0.85 + 0.3 * s),
          r * (1.15 - 0.3 * s),
          crownH / 2,
          ox,
          oy,
          crownBase + crownH / 2,
          turn,
        );
        return;
      }
      // Standing alone, seen whole: a broad main mass, wider than it is deep, and two lobes
      // thrown out to either side, one high and one low, each borne on its own limb - the
      // spreading, uneven outline of an oak, a mango or a plane tree in the open.
      blob(
        'c',
        r,
        r * (0.9 - 0.15 * s),
        crownH * 0.4,
        ox,
        oy,
        crownBase + crownH * 0.5,
        turn,
        broadLeaf,
        7,
        10,
      );
      const fork = crownBase * 0.8;
      const lobes: [string, number, number, number, number][] = [
        // part, direction, reach (x r), height (x crownH), size (x r)
        ['c1', turn + 0.9, 0.62, 0.62, 0.6],
        ['c2', turn + 3.4, 0.66, 0.34, 0.55],
      ];
      lobes.forEach(([part, a, reach, up, size], k) => {
        const e = ox + Math.cos(a) * r * reach;
        const n = oy + Math.sin(a) * r * reach;
        const z = crownBase + crownH * up;
        blob(part, r * size, r * size * 0.9, crownH * size * 0.55, e, n, z, a, broadLeaf, 5, 8);
        limb(`b${k}`, fork, e * 0.7, n * 0.7, z - crownH * 0.1, girth * 0.6);
      });
    });
  }

  /** A footprint's extrusion as a geometry description (not yet triangulated), and its colour. */
  private describeBuilding(
    b: BuildingFootprint,
    gr: FootprintGround | undefined,
  ): { description: Cesium.PolygonGeometry; colour: Cesium.Color } | null {
    const C = this.C;
    const g = gr ?? { centre: 0, low: 0, high: 0 };
    const ground = g.centre;
    const roof = this.roofOf(b, gr);
    const hierarchy = new C.PolygonHierarchy(
      C.Cartesian3.fromDegreesArray(b.outer.flat()),
      b.holes.map((h) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h.flat()))),
    );
    const description = new C.PolygonGeometry({
      polygonHierarchy: hierarchy,
      // On a slope the walls start under the lowest corner, and the top stands clear of the
      // highest (`buildingTop`). A part lifted off the ground keeps its own heights from the
      // centre.
      height: b.minHeightM > 0 ? ground + b.minHeightM : g.low - SINK_M,
      // Under a pitched roof the walls stop at the eaves.
      extrudedHeight: roof ? roof.eaveM : buildingTop(b, g),
      vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
    });
    return { description, colour: buildingColour(C, b) };
  }

  /**
   * The pitched roof a house takes (house-roofs.ts) and its eaves' height above the ellipsoid,
   * or null where the building keeps a flat top: its ridge is where the flat top would be, and
   * on a slope the eaves must still clear the ground at the highest corner by a storey's wall.
   */
  private roofOf(
    b: BuildingFootprint,
    gr: FootprintGround | undefined,
  ): { plan: HipRoof; eaveM: number } | null {
    const plan = hipRoofFor(b);
    if (!plan) return null;
    const g = gr ?? { centre: 0, low: 0, high: 0 };
    const eaveM = buildingTop(b, g) - plan.riseM;
    return eaveM >= g.high + 1.8 ? { plan, eaveM } : null;
  }

  /**
   * A tile's pitched roofs: every house's faces meshed here, a frame's budget at a time (a few
   * multiplications a roof; Cesium's workers have no shape for them), gathered by roofing so a
   * primitive has one instance a colour, and drawn with the buildings' own shader, shadows and
   * picking - the horizon reads a ridge as it reads a parapet. A primitive is prepared on the
   * main thread in the frame that first draws it, so a tile's roofs go ROOFS_PER_PRIMITIVE to a
   * primitive, each in a frame of its own: a city tile of ten thousand houses does not stall
   * one frame for all of them.
   */
  private async loadRoofs(
    state: TileState,
    buildings: readonly BuildingFootprint[],
    grounds: readonly FootprintGround[],
  ): Promise<void> {
    const C = this.C;
    const fresh = () =>
      HOUSE_ROOFS.map(() => ({ positions: [] as number[], normals: [] as number[] }));
    let batches = fresh();
    let pending = 0;
    const scratch = new C.Cartesian3();
    const toWorld = (lon: number, lat: number, heightM: number): [number, number, number] => {
      const p = C.Cartesian3.fromDegrees(lon, lat, heightM, undefined, scratch);
      return [p.x, p.y, p.z];
    };
    const flush = (): boolean => {
      const instances: Cesium.GeometryInstance[] = [];
      batches.forEach((batch, k) => {
        if (batch.positions.length === 0) return;
        const [r, g, bl] = HOUSE_ROOFS[k] as readonly [number, number, number];
        const attributes = new C.GeometryAttributes();
        attributes.position = new C.GeometryAttribute({
          componentDatatype: C.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: new Float64Array(batch.positions),
        });
        attributes.normal = new C.GeometryAttribute({
          componentDatatype: C.ComponentDatatype.FLOAT,
          componentsPerAttribute: 3,
          values: new Float32Array(batch.normals),
        });
        instances.push(
          new C.GeometryInstance({
            geometry: new C.Geometry({
              attributes,
              indices: hipRoofIndices(batch.positions.length / 3 / HIP_ROOF_VERTICES),
              primitiveType: C.PrimitiveType.TRIANGLES,
              boundingSphere: C.BoundingSphere.fromVertices(batch.positions),
            }),
            attributes: {
              color: C.ColorGeometryInstanceAttribute.fromColor(new C.Color(r, g, bl, ROOF_ALPHA)),
            },
          }),
        );
      });
      batches = fresh();
      pending = 0;
      if (instances.length === 0) return true;
      try {
        this.adopt(
          state,
          new C.Primitive({
            geometryInstances: instances,
            appearance: this.appearanceForBuildings(),
            shadows: C.ShadowMode.ENABLED,
            asynchronous: false,
            releaseGeometryInstances: true,
            allowPicking: true,
          }),
        );
        return true;
      } catch (error) {
        // The houses keep their walls and go without roofs.
        this.report(error);
        return false;
      }
    };
    for (let i = 0; i < buildings.length;) {
      await this.nextSlot();
      if (state.cancelled || this.destroyed) return;
      const started = performance.now();
      for (
        ;
        i < buildings.length &&
        pending < ROOFS_PER_PRIMITIVE &&
        performance.now() - started < SLICE_BUDGET_MS;
        i++
      ) {
        const b = buildings[i] as BuildingFootprint;
        const roof = this.roofOf(b, grounds[i]);
        if (!roof) continue;
        const batch = batches[roofShade(b.centre)];
        if (!batch) continue;
        hipRoofMesh(roof.plan, roof.eaveM, toWorld, batch.positions, batch.normals);
        pending++;
      }
      // A primitive's worth: into the scene, and the next roofs wait a frame for it.
      if (pending >= ROOFS_PER_PRIMITIVE && !flush()) return;
    }
    if (pending === 0) return;
    await this.nextSlot();
    if (state.cancelled || this.destroyed) return;
    flush();
  }

  /**
   * Every footprint of a tile as geometry descriptions for the workers, a frame's budget at a
   * time (describing is cheap: no triangulation here). Null when the tile went away meanwhile.
   */
  private async describeAll(
    state: TileState,
    buildings: readonly BuildingFootprint[],
    grounds: readonly FootprintGround[],
  ): Promise<Cesium.GeometryInstance[] | null> {
    const C = this.C;
    const out: Cesium.GeometryInstance[] = [];
    let i = 0;
    while (i < buildings.length) {
      await this.nextSlot();
      if (state.cancelled || this.destroyed) return null;
      const started = performance.now();
      for (; i < buildings.length; i++) {
        if (performance.now() - started > SLICE_BUDGET_MS) break;
        try {
          const d = this.describeBuilding(buildings[i] as BuildingFootprint, grounds[i]);
          if (d)
            out.push(
              new C.GeometryInstance({
                geometry: d.description,
                attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(d.colour) },
              }),
            );
        } catch {
          // An outline Cesium refuses even to describe is left out.
        }
      }
    }
    return out;
  }

  /**
   * Buildings from `from` on, up to SLICE of them or SLICE_BUDGET_MS of work, as one primitive;
   * `next` is where the following slice starts. Each footprint that built is also added to
   * `again` as a geometry description, for the tile's merge.
   */
  private buildSlice(
    buildings: readonly BuildingFootprint[],
    grounds: readonly FootprintGround[],
    from: number,
    again: Cesium.GeometryInstance[],
  ): { primitive: Cesium.Primitive | null; next: number } {
    const C = this.C;
    const instances: Cesium.GeometryInstance[] = [];
    const started = performance.now();
    let i = from;
    for (; i < buildings.length && i < from + SLICE; i++) {
      if (i > from && performance.now() - started > SLICE_BUDGET_MS) break;
      const b = buildings[i] as BuildingFootprint;
      try {
        const described = this.describeBuilding(b, grounds[i]);
        if (!described) continue;
        const { description, colour } = described;
        const geometry = C.PolygonGeometry.createGeometry(description);
        if (!geometry) continue;
        instances.push(
          new C.GeometryInstance({
            geometry,
            attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(colour) },
          }),
        );
        again.push(
          new C.GeometryInstance({
            geometry: description,
            attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(colour) },
          }),
        );
      } catch {
        // A footprint Cesium cannot triangulate is left out.
      }
    }
    if (instances.length === 0) return { primitive: null, next: i };
    const primitive = new C.Primitive({
      geometryInstances: instances,
      appearance: this.appearanceForBuildings(),
      shadows: C.ShadowMode.ENABLED,
      asynchronous: false,
      releaseGeometryInstances: true,
      allowPicking: true,
    });
    return { primitive, next: i };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.removeGuard();
    if (this.treeWaitTimer !== null) clearTimeout(this.treeWaitTimer);
    this.treesWaiting.clear();
    this.merging.clear();
    for (const s of this.tiles.values()) s.cancelled = true;
    this.tiles.clear();
    this.owned.clear();
    this.treePrims.clear();
    this.buildingPrims.clear();
    this.scene.primitives.remove(this.collection); // destroys it and its primitives
  }
}

/**
 * The top of a building above the ellipsoid. On a slope it stands clear of the ground at the
 * highest corner (V&V: Kyoto's Higashiyama, where the hillside came up through roofs in a
 * saw-tooth of terrain triangles); a part lifted off the ground keeps its own height from the
 * centre.
 */
function buildingTop(b: BuildingFootprint, g: FootprintGround): number {
  return b.minHeightM > 0
    ? g.centre + b.heightM
    : Math.max(g.centre + b.heightM, g.high + Math.min(b.heightM, 2.5));
}

/**
 * Facade colours for buildings OpenStreetMap gives none: plaster, concrete, sandstone, brick,
 * with glass-and-steel greys for towers. Picked per building from its position, so a street of
 * houses is not one colour and the same building keeps its colour.
 */
const LOW_RISE: [number, number, number][] = [
  [0.86, 0.84, 0.8], // white plaster
  [0.78, 0.76, 0.72], // concrete
  [0.8, 0.72, 0.6], // sandstone
  [0.72, 0.66, 0.58], // warm render
  [0.62, 0.42, 0.34], // brick
  [0.7, 0.7, 0.68], // grey render
];
const HIGH_RISE: [number, number, number][] = [
  [0.62, 0.68, 0.74], // blue glass
  [0.74, 0.76, 0.78], // steel and glass
  [0.82, 0.8, 0.76], // concrete tower
  [0.56, 0.6, 0.62], // dark glass
];

function facadeColour(C: CesiumModule, b: BuildingFootprint): Cesium.Color {
  const h = Math.abs(Math.sin(b.centre[0] * 12.9898 + b.centre[1] * 78.233) * 43758.5453) % 1;
  const set = b.heightM > 35 ? HIGH_RISE : LOW_RISE;
  const [r, g, bl] = set[Math.floor(h * set.length) % set.length] ?? [0.8, 0.78, 0.74];
  // A little per-building shade so neighbours of one material still differ.
  const shade = 0.92 + 0.12 * ((h * 7.31) % 1);
  return new C.Color(r * shade, g * shade, bl * shade, FACADE_ALPHA[facadeKind(b.heightM, h)]);
}

/** OSM's own colour when mapped (tempered toward the facade so it reads under any light), else a facade colour. */
function buildingColour(C: CesiumModule, b: BuildingFootprint): Cesium.Color {
  const facade = facadeColour(C, b);
  if (!b.colour) return facade;
  try {
    const c = C.Color.fromCssColorString(b.colour);
    if (!c) return facade;
    const mixed = C.Color.lerp(facade, c, 0.6, new C.Color());
    // The alpha is the glazing's mark, not a colour's.
    mixed.alpha = facade.alpha;
    return mixed;
  } catch {
    return facade;
  }
}

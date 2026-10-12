/**
 * Ground texture parameters (Phase 4 "improved terrain texture"): what the procedural surface
 * (`shaders/ground.frag.ts`) needs from the scene — where snow lies here at this time of year,
 * which way is poleward, and how strongly to paint over the basemap. Pure, unit-tested; the
 * rules are a texture's, not a snow model's (`RENDERING_ACCURACY.md`).
 */
import { SNOW_ON_GROUND_M, type SceneState } from '@lightmap/scene';

export interface GroundTextureParams {
  /** Height above the ellipsoid from which snow lies, metres. */
  snowlineM: number;
  /** Height above which the cover thins to alpine ground, metres: the climatic snowline less 900 m, fixed through the year. */
  treelineM: number;
  /** +1 north of the equator, −1 south: which slopes face away from the Sun's noon side. */
  poleward: 1 | -1;
  /** Opacity over the basemap, 0–1. */
  strength: number;
  /** How arid the region reads, 0 (vegetated) – 1 (desert), from the basemap's own colour. */
  aridity: number;
  /** How much of the region is ice sheet, 0–1, from the basemap's own colour. */
  ice: number;
  /** The chart's brightness (1 by day; the unlit night chart is dimmed), applied to the surface too. */
  brightness: number;
  /** Ellipsoidal height of sea level at the place, metres, so shore and snow read true heights. */
  seaLevelM: number;
  /** How strongly broken cloud dapples the ground, 0–1 (`cloudShadowStrength`). */
  cloudShadow: number;
  /** What the quality rung affords: 0 the base surface, 1 with cloud shadows, 2 with relief and the near grain. */
  detail: 0 | 1 | 2;
}

/**
 * How much the ground is dappled by the shadows of broken cloud: nothing under a clear sky
 * (no cloud) or an overcast one (the light is already diffuse and dimmed as a whole), most at
 * half cover of the low and mid decks, and nothing without direct sunlight. 4c(1−c) over the
 * sun-blocking cover, scaled by the direct-light share.
 */
export function cloudShadowStrength(
  layers: { low: number; mid: number },
  sunTransmittance: number,
  sunElevationDeg: number,
): number {
  if (sunElevationDeg <= -0.833 || sunTransmittance <= 0.12) return 0;
  const cover = Math.max(0, Math.min(1, layers.low + 0.6 * layers.mid));
  return Math.round(4 * cover * (1 - cover) * Math.min(1, sunTransmittance / 0.6) * 100) / 100;
}

/** What the renderer knows beyond the scene: the chart dimming, the geoid and the ground at the pin. */
export interface GroundTextureContext {
  brightness: number;
  seaLevelM: number;
  /** The terrain's height at the pin above sea level, metres; null until sampled. */
  groundHeightM?: number | null;
}

/** Snow on the ground at the model's grid point from this depth paints the pin's height snowy, metres (the Snow line's own threshold). */
export const FORECAST_SNOW_M = SNOW_ON_GROUND_M;

/**
 * The snowline with the forecast's word on it: inside the forecast horizon the frame says
 * whether snow lies at the pin's own height (the model's grid point), so the line is pulled
 * down to just under the pin when it does and pushed up to just over it when it does not;
 * beyond the horizon (a scenario, no frame) the latitude-and-season rule stands alone.
 */
export function snowlineWithForecast(
  climatologicalM: number,
  snowDepthM: number | null | undefined,
  groundHeightM: number | null | undefined,
): number {
  if (snowDepthM === null || snowDepthM === undefined) return climatologicalM;
  if (groundHeightM === null || groundHeightM === undefined) return climatologicalM;
  if (snowDepthM >= FORECAST_SNOW_M) return Math.min(climatologicalM, groundHeightM - 150);
  return Math.max(climatologicalM, groundHeightM + 150);
}

/** What the coarse basemap's colour says about the region around a point. */
export interface LandHint {
  aridity: number;
  ice: number;
}

export const NEUTRAL_LAND_HINT: LandHint = { aridity: 0.25, ice: 0 };

/**
 * The land-class hint from a basemap colour (sRGB 0–255), as Natural Earth II paints it: green
 * for vegetation, tan through brown for steppe and desert, white for ice. Aridity is the
 * red-over-green excess (green land ≈ 0, tan ≈ 0.75, the brown-grey of high mountains ≈ 0.5);
 * ice is how far the darkest channel climbs toward white. A tint, not a classification: it
 * tells the texture which way to lean, never what a given pixel is.
 */
/** Whether a basemap pixel is sea or lake (blue), which says nothing about the land. */
export function isWaterColor(rgb: readonly [number, number, number]): boolean {
  const [r, g, b] = rgb;
  return b > r + 15 && b > g + 5;
}

/**
 * The land hint from a patch of basemap pixels: water pixels are left out and the rest
 * averaged, so a desert coast reads as desert, not as the mean of tan and blue; neutral when
 * every pixel is water.
 */
export function landHintFromPixels(
  pixels: ReadonlyArray<readonly [number, number, number]>,
): LandHint {
  const land = pixels.filter((p) => !isWaterColor(p));
  if (land.length === 0) return NEUTRAL_LAND_HINT;
  const mean: [number, number, number] = [0, 0, 0];
  for (const p of land) {
    mean[0] += p[0] / land.length;
    mean[1] += p[1] / land.length;
    mean[2] += p[2] / land.length;
  }
  return landHintFromColor(mean);
}

export function landHintFromColor(rgb: readonly [number, number, number]): LandHint {
  const [r, g, b] = rgb;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const ice = clamp01((Math.min(r, g, b) - 185) / 45);
  // Blue (sea, lakes) says nothing about the land: lean on the neutral hint.
  if (isWaterColor(rgb)) return { aridity: NEUTRAL_LAND_HINT.aridity, ice };
  return { aridity: clamp01((r - g + 10) / 40) * (1 - ice), ice };
}

/** Climatic (late-summer) snowline by latitude, metres: ≈ 5 200 m at the equator, ≈ 3 000 m at 45°, ≈ 1 700 m at 60°, a few hundred at 80°. */
export function permanentSnowlineM(latitudeDeg: number): number {
  const c = Math.cos((Math.min(89.9, Math.abs(latitudeDeg)) * Math.PI) / 180);
  return 5200 * Math.pow(c, 1.6);
}

/**
 * The snowline at a latitude on a day of the year, metres above the ellipsoid: the climatic
 * line in late summer, lower through winter by a share that grows with latitude (the tropics
 * barely move; mid-latitudes fall by half, so the Alps read snowy from ≈ 1 500 m in February and
 * bare below ≈ 3 000 m in August). The seasons flip across the equator; the coldest point lags
 * the solstice by about seven weeks.
 */
export function snowlineM(latitudeDeg: number, dayOfYear: number): number {
  const permanent = permanentSnowlineM(latitudeDeg);
  const south = latitudeDeg < 0;
  // Northern winter deepest on day 40 (9 February); southern on day 222 (10 August).
  const coldest = south ? 222 : 40;
  const winter = (1 + Math.cos((2 * Math.PI * (dayOfYear - coldest)) / 365.25)) / 2;
  const amplitude = 0.6 * Math.pow(Math.min(1, Math.abs(latitudeDeg) / 50), 1.5);
  return permanent * (1 - amplitude * winter);
}

/** Day of the year (1–366) of a UTC instant. */
export function dayOfYearUtc(utc: Date): number {
  const start = Date.UTC(utc.getUTCFullYear(), 0, 1);
  return Math.floor((utc.getTime() - start) / 86_400_000) + 1;
}

/**
 * The ground texture for a scene (with the region's land hint, neutral until sampled), or null when it is off (`render.groundTexture === false`) or
 * the quality rung has turned it off (Minimal: no shadows either). Strength follows the quality:
 * full on every rung that shades.
 */
export function groundTextureFor(
  scene: SceneState,
  hint: LandHint = NEUTRAL_LAND_HINT,
  context: GroundTextureContext = { brightness: 1, seaLevelM: 0 },
): GroundTextureParams | null {
  if (scene.render.groundTexture === false) return null;
  if (!scene.render.shadows) return null;
  const lat = scene.location.point.latitude;
  return {
    snowlineM: Math.round(
      snowlineWithForecast(
        snowlineM(lat, dayOfYearUtc(scene.utc)),
        scene.atmosphere.frame?.snowDepth,
        context.groundHeightM,
      ),
    ),
    treelineM: Math.round(Math.max(0, permanentSnowlineM(lat) - 900)),
    poleward: lat < 0 ? -1 : 1,
    strength: 1,
    aridity: Math.round(hint.aridity * 100) / 100,
    ice: Math.round(hint.ice * 100) / 100,
    brightness: Math.round(Math.max(0, Math.min(1, context.brightness)) * 100) / 100,
    seaLevelM: Math.round(context.seaLevelM),
    // Ultra/High (soft shadows) carry everything; Balanced drops the per-fragment relief and
    // grain; Battery keeps the base surface only.
    detail: scene.render.softShadows ? 2 : scene.render.shadowMapSize >= 2048 ? 1 : 0,
    cloudShadow: cloudShadowStrength(
      scene.atmosphere.parameters.cloudLayers,
      scene.atmosphere.parameters.sunTransmittance,
      scene.solar.elevationDegrees,
    ),
  };
}

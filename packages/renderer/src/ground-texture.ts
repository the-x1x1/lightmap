/**
 * Ground texture parameters (Phase 4 "improved terrain texture"): what the procedural surface
 * (`shaders/ground.frag.ts`) needs from the scene — where snow lies here at this time of year,
 * which way is poleward, and how strongly to paint over the basemap. Pure, unit-tested; the
 * rules are a texture's, not a snow model's (`RENDERING_ACCURACY.md`).
 */
import type { SceneState } from '@lightmap/scene';

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
export function landHintFromColor(rgb: readonly [number, number, number]): LandHint {
  const [r, g, b] = rgb;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const ice = clamp01((Math.min(r, g, b) - 185) / 45);
  // Blue (sea, lakes) says nothing about the land: lean on the neutral hint.
  if (b > r + 15 && b > g + 5) return { aridity: NEUTRAL_LAND_HINT.aridity, ice };
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
): GroundTextureParams | null {
  if (scene.render.groundTexture === false) return null;
  if (!scene.render.shadows) return null;
  const lat = scene.location.point.latitude;
  return {
    snowlineM: Math.round(snowlineM(lat, dayOfYearUtc(scene.utc))),
    treelineM: Math.round(Math.max(0, permanentSnowlineM(lat) - 900)),
    poleward: lat < 0 ? -1 : 1,
    strength: 1,
    aridity: Math.round(hint.aridity * 100) / 100,
    ice: Math.round(hint.ice * 100) / 100,
  };
}

/**
 * The night line on a saved viewpoint card (night planning): for a shot planned after civil
 * dusk, where the Milky Way core stands at that instant and whether the sky can show it — the
 * same verdict the planner shows, computed from the saved place and instant alone. Pure.
 */
import { milkyWayCore, type MilkyWayVerdict } from '@lightmap/astronomy';
import { compassLabel } from '@lightmap/geospatial';

export interface NightTag {
  verdict: MilkyWayVerdict;
  text: string;
}

export function nightTag(v: {
  latitude: number;
  longitude: number;
  selectedDatetimeUtc: string;
}): NightTag | null {
  const at = new Date(v.selectedDatetimeUtc);
  if (Number.isNaN(at.getTime())) return null;
  const core = milkyWayCore(at, v.latitude, v.longitude);
  // Only night shots carry the line; by day the core is nobody's concern.
  if (core.sunElevationDeg > -6) return null;
  const where =
    core.elevationDeg > 0
      ? `core ${Math.round(core.elevationDeg)}° up ${compassLabel(core.azimuthDeg)}`
      : 'core below the horizon';
  const state =
    core.verdict === 'visible'
      ? 'dark sky'
      : core.verdict === 'moonlit'
        ? `Moon ${Math.round(core.moonIlluminatedFraction * 100)} % lit`
        : core.verdict === 'twilight'
          ? 'twilight'
          : core.verdict === 'low'
            ? 'low in haze'
            : null;
  return {
    verdict: core.verdict,
    text: `Milky Way ${where}${state ? ` · ${state}` : ''}`,
  };
}

/**
 * "Why does it look like this?" (plan §3.10): a compact, honest explanation assembled from the
 * SceneState. Pure; the UI renders the lines.
 */
import { compassLabel } from '@lightmap/geospatial';
import { scenarioById } from '@lightmap/weather';
import { SOURCE_MODE_LABEL } from './confidence.ts';
import { lightingGeometry } from './camera.ts';
import type { SceneState } from './types.ts';

export interface ExplanationLine {
  label: string;
  value: string;
  /** Which confidence dimension backs this line, so the UI can badge it. */
  basis: 'astronomy' | 'environment' | 'weather' | 'imagery' | 'camera';
}

export function explainScene(s: SceneState): ExplanationLine[] {
  const lines: ExplanationLine[] = [];
  const el = s.solar.elevationDegrees;
  lines.push({
    label: 'Sun',
    value:
      el < -0.833
        ? `${Math.abs(el).toFixed(0)}° below the horizon (${s.solar.phase.replace('-', ' ')})`
        : `${el.toFixed(0)}° elevation, ${s.solar.phase.replace('-', ' ')}`,
    basis: 'astronomy',
  });
  lines.push({
    label: 'Light direction',
    value: `from the ${compassLabel(s.solar.azimuthDegrees)} (${Math.round(s.solar.azimuthDegrees)}°)`,
    basis: 'astronomy',
  });
  if (el > -0.833) {
    lines.push({
      label: 'Shadows fall',
      value: `toward the ${compassLabel((s.solar.azimuthDegrees + 180) % 360)}, ${shadowLengthText(el)}`,
      basis: 'astronomy',
    });
    lines.push({
      label: 'Colour',
      value: `${Math.round(s.atmosphere.colorTemperatureK)} K — ${warmthText(s.atmosphere.warmth)}`,
      basis: 'astronomy',
    });
  }
  const geo = lightingGeometry(s.camera, s.solar.azimuthDegrees, el);
  lines.push({ label: 'Relative to camera', value: geo.replace('-', ' '), basis: 'camera' });
  const scenarioLabel = scenarioById(s.atmosphere.scenario).label;
  lines.push({
    label: s.atmosphere.mode === 'SCENARIO' ? 'Weather scenario' : 'Weather',
    value:
      s.atmosphere.mode === 'SCENARIO'
        ? `${scenarioLabel} (scenario, not a forecast)`
        : `${scenarioLabel} — ${s.atmosphere.summary}`,
    basis: 'weather',
  });
  lines.push({
    label: 'Direct light reaching the ground',
    value: `${Math.round(s.atmosphere.parameters.sunTransmittance * 100)} %`,
    basis: 'weather',
  });
  lines.push({
    label: 'Scene source',
    value: `${SOURCE_MODE_LABEL[s.sourceMode]} — ${s.confidence.notes.environment.toLowerCase()}`,
    basis: 'environment',
  });
  lines.push({
    label: 'Confidence',
    value: `astronomy ${s.confidence.astronomy.toLowerCase()}, environment ${s.confidence.environment.toLowerCase()}, weather ${s.confidence.weather === 'SCENARIO' ? 'scenario-only' : s.confidence.weather.toLowerCase()}`,
    basis: 'imagery',
  });
  return lines;
}

function shadowLengthText(elevationDeg: number): string {
  if (elevationDeg >= 60) return 'very short';
  if (elevationDeg >= 30) return 'short';
  if (elevationDeg >= 10) return 'long';
  return 'very long and soft-edged';
}

function warmthText(warmth: number): string {
  if (warmth > 0.8) return 'strongly golden';
  if (warmth > 0.6) return 'warm';
  if (warmth > 0.4) return 'neutral daylight';
  if (warmth > 0.2) return 'cool';
  return 'deep blue';
}

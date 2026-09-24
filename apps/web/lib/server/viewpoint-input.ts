import 'server-only';
import { isValidTimeZone } from '@lightmap/astronomy';
import { isScenarioId } from '@lightmap/weather';
import type { ViewpointInput, SnapshotInput } from '@lightmap/database';
import { v } from './http.ts';

const WEATHER_MODES = ['FORECAST', 'EXTENDED_FORECAST', 'SCENARIO', 'RECENT_PAST', 'PAST'] as const;
const SOURCE_TYPES = ['REAL_REFERENCE', 'SIMULATED_LIGHTING', 'ESTIMATED_PREVIEW'] as const;

/** Validate a viewpoint body (create: all fields; patch: any subset). Thumbnails are capped at ~200 KB. */
export function parseViewpoint(body: unknown, mode: 'create' | 'patch'): { input: Partial<ViewpointInput>; snapshot: SnapshotInput | undefined } {
  const o = v.obj(body);
  const opt = mode === 'patch';
  const input: Partial<ViewpointInput> = {};
  const label = v.string(o['label'], 'label', { min: 1, max: 120, optional: opt });
  if (label !== undefined && label !== null) input.label = label;
  const lat = v.number(o['latitude'], 'latitude', -90, 90, { optional: opt });
  if (lat !== undefined && lat !== null) input.latitude = lat;
  const lng = v.number(o['longitude'], 'longitude', -180, 180, { optional: opt });
  if (lng !== undefined && lng !== null) input.longitude = lng;
  const elev = v.number(o['elevationM'], 'elevationM', -500, 9000, { optional: true, nullable: true });
  if (elev !== undefined) input.elevationM = elev;
  const tz = v.string(o['timezone'], 'timezone', { min: 1, max: 64, optional: opt });
  if (tz !== undefined && tz !== null) {
    if (!isValidTimeZone(tz)) throw new Error('timezone must be an IANA zone');
    input.timezone = tz;
  }
  const heading = v.number(o['headingDeg'], 'headingDeg', 0, 360, { optional: opt });
  if (heading !== undefined && heading !== null) input.headingDeg = heading % 360;
  const pitch = v.number(o['pitchDeg'], 'pitchDeg', -90, 90, { optional: opt });
  if (pitch !== undefined && pitch !== null) input.pitchDeg = pitch;
  const fov = v.number(o['fieldOfViewDeg'], 'fieldOfViewDeg', 1, 179, { optional: opt });
  if (fov !== undefined && fov !== null) input.fieldOfViewDeg = fov;
  const focal = v.number(o['focalLengthEquivalentMm'], 'focalLengthEquivalentMm', 1, 2000, { optional: true, nullable: true });
  if (focal !== undefined) input.focalLengthEquivalentMm = focal;
  if (o['selectedDatetimeUtc'] !== undefined || !opt) input.selectedDatetimeUtc = v.instant(o['selectedDatetimeUtc'], 'selectedDatetimeUtc');
  const wm = v.oneOf(o['weatherMode'], 'weatherMode', WEATHER_MODES, { optional: opt });
  if (wm !== undefined && wm !== null) input.weatherMode = wm;
  if (o['weatherScenario'] !== undefined) {
    const ws = o['weatherScenario'];
    if (ws !== null && !isScenarioId(ws)) throw new Error('weatherScenario is not a known scenario');
    input.weatherScenario = ws as string | null;
  }
  const st = v.oneOf(o['previewSourceType'], 'previewSourceType', SOURCE_TYPES, { optional: opt });
  if (st !== undefined && st !== null) input.previewSourceType = st;

  let snapshot: SnapshotInput | undefined;
  if (o['snapshot'] !== undefined && o['snapshot'] !== null) {
    const s = v.obj(o['snapshot']);
    const thumb = v.string(s['thumbnailDataUrl'], 'thumbnailDataUrl', { optional: true, nullable: true, max: 220_000 });
    if (thumb && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb)) throw new Error('thumbnailDataUrl must be a base64 image data URL');
    snapshot = {
      sourceType: v.oneOf(s['sourceType'], 'snapshot.sourceType', SOURCE_TYPES) as string,
      providerMetadata: s['providerMetadata'] ?? {},
      astronomyState: s['astronomyState'] ?? {},
      weatherState: s['weatherState'] ?? {},
      confidenceState: s['confidenceState'] ?? {},
      thumbnailDataUrl: thumb ?? null,
    };
  }
  return { input, snapshot };
}

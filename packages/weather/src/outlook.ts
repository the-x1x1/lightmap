/**
 * Hourly outlook for one civil day (plan §4 "hourly frames"; Pro "hourly forecast detail"):
 * the fetched frames of the day reduced to one row per local hour, each classified with the same
 * scenario thresholds as the live preview and carrying the direct-light share the renderer would
 * use. Pure; the UI draws it as bars and as a table. Hours without a frame are absent — nothing is
 * invented for gaps, and a scenario day (no frames) yields an empty outlook.
 */
import {
  parametersForForecast,
  scenarioForConditions,
  type WeatherScenarioId,
} from './scenarios.ts';
import { interpolateFrame, type WeatherFrame } from './model.ts';

export interface OutlookHour {
  /** UTC instant of the local hour's start (HH:00), where the provider's frame is valid. */
  timestampUtc: string;
  /** Local hour 0–23. */
  hour: number;
  cloudCoverTotal: number;
  cloudCoverLow: number | null;
  precipitationProbability: number | null;
  precipitationAmount: number | null;
  /** 0–1 share of direct sunlight reaching the ground (cloud only; not solar elevation). */
  directLightShare: number;
  scenario: WeatherScenarioId;
  weatherCode: number | null;
}

/**
 * One row per local hour whose start lies inside the frame range (frames are valid at HH:00, so
 * the row is the provider's own value for that hour, not a blend with the next). `hourStart`
 * returns the UTC instant of local hour `h` on the day, so DST days (23/25 hours) come out right.
 */
export function hourlyOutlook(
  frames: readonly WeatherFrame[],
  hourStart: (hour: number) => Date | null,
  hoursInDay = 24,
): OutlookHour[] {
  if (frames.length === 0) return [];
  const first = Date.parse(frames[0]!.timestamp);
  const last = Date.parse(frames[frames.length - 1]!.timestamp);
  const out: OutlookHour[] = [];
  const starts: Array<{ h: number; start: Date }> = [];
  for (let h = 0; h < hoursInDay; h++) {
    const start = hourStart(h);
    if (!start) continue;
    // A DST gap maps two wall-clock hours to one instant; keep the later label (the hour that exists).
    const prev = starts[starts.length - 1];
    if (prev && prev.start.getTime() === start.getTime()) starts.pop();
    starts.push({ h, start });
  }
  for (const { h, start } of starts) {
    const t = start.getTime();
    if (t < first || t > last) continue; // only hours the provider actually covered
    const f = interpolateFrame(frames, start);
    if (!f) continue;
    const params = parametersForForecast(f);
    out.push({
      timestampUtc: start.toISOString(),
      hour: h,
      cloudCoverTotal: f.cloudCoverTotal,
      cloudCoverLow: f.cloudCoverLow,
      precipitationProbability: f.precipitationProbability,
      precipitationAmount: f.precipitationAmount,
      directLightShare: params.sunTransmittance,
      scenario: scenarioForConditions(f.cloudCoverTotal, {
        precipitationAmount: f.precipitationAmount,
        precipitationProbability: f.precipitationProbability,
        weatherCode: f.weatherCode,
      }),
      weatherCode: f.weatherCode,
    });
  }
  return out;
}

/**
 * Contiguous runs of hours with at least `minDirect` direct light (the "clear windows" a
 * photographer scans for). Each run is [fromHour, toHour] inclusive.
 */
export function brightWindows(
  hours: readonly OutlookHour[],
  minDirect = 0.6,
): Array<{ fromHour: number; toHour: number; meanDirect: number }> {
  const runs: Array<{ fromHour: number; toHour: number; meanDirect: number }> = [];
  let cur: { fromHour: number; toHour: number; sum: number; n: number } | null = null;
  for (const h of hours) {
    const bright = h.directLightShare >= minDirect;
    if (bright && cur && h.hour === cur.toHour + 1) {
      cur.toHour = h.hour;
      cur.sum += h.directLightShare;
      cur.n++;
    } else if (bright) {
      if (cur)
        runs.push({ fromHour: cur.fromHour, toHour: cur.toHour, meanDirect: cur.sum / cur.n });
      cur = { fromHour: h.hour, toHour: h.hour, sum: h.directLightShare, n: 1 };
    } else if (cur) {
      runs.push({ fromHour: cur.fromHour, toHour: cur.toHour, meanDirect: cur.sum / cur.n });
      cur = null;
    }
  }
  if (cur) runs.push({ fromHour: cur.fromHour, toHour: cur.toHour, meanDirect: cur.sum / cur.n });
  return runs;
}

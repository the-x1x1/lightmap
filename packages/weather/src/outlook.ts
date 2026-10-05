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
  /** The field conditions of the hour (wind on the tripod, moisture on the glass). */
  humidity: number | null;
  /** m/s. */
  windSpeed: number | null;
  /** metres. */
  visibility: number | null;
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
  const exact = new Map(frames.map((f) => [Date.parse(f.timestamp), f]));
  for (const { h, start } of starts) {
    const t = start.getTime();
    if (t < first || t > last) continue; // only hours the provider actually covered
    // The provider's own frame for the hour when it has one (a null stays null there); a blend
    // only for an hour the frames straddle.
    const f = exact.get(t) ?? interpolateFrame(frames, start);
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
      humidity: f.humidity,
      windSpeed: f.windSpeed,
      visibility: f.visibility,
    });
  }
  return out;
}

export interface HourRun {
  fromHour: number;
  toHour: number;
}

/**
 * Contiguous runs of consecutive hours for which `pick` holds — "humidity at or over 95 %
 * 02:00–06:00", "wind at or over 8 m/s 13:00–16:00". Each run is [fromHour, toHour] inclusive;
 * a missing hour (the provider did not cover it) or one whose field the provider left unknown
 * breaks a run — nothing is assumed about it.
 */
export function hourRuns(
  hours: readonly OutlookHour[],
  pick: (hour: OutlookHour) => boolean,
): HourRun[] {
  const runs: HourRun[] = [];
  let cur: HourRun | null = null;
  for (const h of hours) {
    if (pick(h) && cur && h.hour === cur.toHour + 1) cur.toHour = h.hour;
    else if (pick(h)) {
      if (cur) runs.push(cur);
      cur = { fromHour: h.hour, toHour: h.hour };
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

/** Relative humidity from which dew (at night) or mist (by day) is likely on the glass. */
export const HUMID_HOUR_THRESHOLD = 95;
/** Beaufort 5, a fresh breeze: the wind starts to matter to a tripod. */
export const WINDY_HOUR_MPS = 8;

/** The hours at or over `HUMID_HOUR_THRESHOLD` % relative humidity, as runs. */
export function humidHours(hours: readonly OutlookHour[], threshold = HUMID_HOUR_THRESHOLD) {
  return hourRuns(hours, (h) => h.humidity !== null && h.humidity >= threshold);
}

/** The hours at or over `WINDY_HOUR_MPS`, as runs. */
export function windyHours(hours: readonly OutlookHour[], mps = WINDY_HOUR_MPS) {
  return hourRuns(hours, (h) => h.windSpeed !== null && h.windSpeed >= mps);
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

/**
 * The cloud over a set of spells (night planning: the dark hours the Milky Way core can be shot),
 * from the hours whose start lies inside one of them — mean total cloud, the clearest hour, and
 * how many hours the outlook covers. Null when no hour of the outlook falls in a spell: nothing
 * is said about hours the provider did not give.
 */
export function cloudOverSpells(
  hours: readonly OutlookHour[],
  spells: ReadonlyArray<{ from: Date; to: Date }>,
): { hours: number; meanCloudCover: number; clearestHour: number; clearestCloud: number } | null {
  let n = 0;
  let sum = 0;
  let clearestHour = -1;
  let clearestCloud = Number.POSITIVE_INFINITY;
  for (const h of hours) {
    const t = Date.parse(h.timestampUtc);
    // Half-open: an hour starting exactly when the spell ends has no dark minutes in it.
    if (!spells.some((s) => s.from.getTime() <= t && t < s.to.getTime())) continue;
    n++;
    sum += h.cloudCoverTotal;
    if (h.cloudCoverTotal < clearestCloud) {
      clearestCloud = h.cloudCoverTotal;
      clearestHour = h.hour;
    }
  }
  if (n === 0) return null;
  return { hours: n, meanCloudCover: sum / n, clearestHour, clearestCloud };
}

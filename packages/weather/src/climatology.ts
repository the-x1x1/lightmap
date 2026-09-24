/**
 * Climatology (plan §25 Phase 7): "What is this place *typically* like in May, in daylight?"
 *
 * This is the third thing in WEATHER_AND_FORECAST_MODEL.md §1 — neither a forecast nor a
 * scenario. It is a distribution over past years, expressed in the same five scenario classes the
 * user can pick, so the numbers and the buttons agree: "Clear 44 %, Mostly clear 20 %, …". The
 * rules (§8): shown only as "Typical for this month"; may suggest which scenario to look at first;
 * never selects one silently; never labelled a forecast; confidence never above SCENARIO.
 *
 * `summarizeClimatology()` is pure and provider-agnostic: give it hourly (cloud cover, precipitation)
 * records for the same calendar month across several years and it classifies each hour with the
 * same `scenarioForConditions()` the live forecast uses.
 */
import { scenarioForConditions, type WeatherScenarioId } from './scenarios.ts';

export interface ClimatologyHour {
  /** UTC ISO instant. */
  timestamp: string;
  /** 0–100 %. */
  cloudCoverTotal: number;
  /** mm for the hour; null when unknown. */
  precipitationAmount: number | null;
}

export interface ClimatologyWindow {
  /** Local hours [startHour, endHour) kept in the sample, e.g. 6–20 for daylight. */
  startHour: number;
  endHour: number;
}

export interface ClimatologySummary {
  kind: 'CLIMATOLOGY';
  providerId: string;
  latitude: number;
  longitude: number;
  /** 1–12. */
  month: number;
  timeZone: string;
  window: ClimatologyWindow;
  years: { from: number; to: number; count: number };
  /** Hours that went into the distribution. */
  sampleHours: number;
  /** Fraction of sampled hours per scenario class; sums to 1 (±rounding). */
  scenarioShare: Record<WeatherScenarioId, number>;
  /** Mean total cloud cover over the sample, %. */
  meanCloudCover: number;
  /** Fraction of sampled hours with ≥ 0.1 mm precipitation. */
  wetHourShare: number;
  /** Fraction of days (any hour in the window) with ≥ 1 mm precipitation. */
  wetDayShare: number;
  /**
   * The same statistics per local hour of day, 0–23, over the whole day (not only the window),
   * so "mornings are clearer than afternoons here" is visible. Hours with no samples have
   * `samples: 0` and zeros elsewhere.
   */
  byHour: ClimatologyHourOfDay[];
  attribution: string;
  license: string;
  /** Wording the UI must use; never "forecast". */
  label: 'Typical for this month';
}

export interface ClimatologyHourOfDay {
  /** Local hour of day, 0–23. */
  hour: number;
  samples: number;
  /** Mean total cloud cover in this hour, %. */
  meanCloudCover: number;
  /** Fraction of sampled hours classed clear or mostly clear. */
  clearShare: number;
  /** Fraction of sampled hours classed overcast or storm. */
  dullShare: number;
  /** Fraction with ≥ 0.1 mm precipitation. */
  wetShare: number;
}

export interface ClimatologyCapabilities {
  providerId: string;
  /** First year the archive covers. */
  earliestYear: number;
  /** Default number of years summarised. */
  defaultYears: number;
  isFixture: boolean;
  attribution: string;
  license: string;
  commercialReview: 'approved' | 'conditional' | 'blocked';
}

export interface ClimatologyProvider {
  getCapabilities(): ClimatologyCapabilities;
  /**
   * Hourly cloud cover and precipitation for one calendar month of one year, in UTC timestamps.
   * Implementations fetch; `summarizeClimatology` does the maths.
   */
  getMonthHours(
    lat: number,
    lng: number,
    year: number,
    month: number,
    opts?: { signal?: AbortSignal },
  ): Promise<ClimatologyHour[]>;
}

export const DAYLIGHT_WINDOW: ClimatologyWindow = { startHour: 6, endHour: 20 };

const SCENARIO_IDS: WeatherScenarioId[] = [
  'clear',
  'mostly-clear',
  'partly-cloudy',
  'overcast',
  'storm',
];

const dtfCache = new Map<string, Intl.DateTimeFormat>();

/** Local hour (0–23) and civil date key for a UTC instant in `timeZone`, via Intl (no library). */
function localParts(iso: string, timeZone: string): { hour: number; dateKey: string } {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
    });
    dtfCache.set(timeZone, dtf);
  }
  const parts = dtf.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return {
    hour: Number(get('hour')) % 24,
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export function summarizeClimatology(
  hours: readonly ClimatologyHour[],
  meta: {
    providerId: string;
    latitude: number;
    longitude: number;
    month: number;
    timeZone: string;
    years: { from: number; to: number };
    window?: ClimatologyWindow;
    attribution: string;
    license: string;
  },
): ClimatologySummary {
  const window = meta.window ?? DAYLIGHT_WINDOW;
  const counts: Record<WeatherScenarioId, number> = {
    clear: 0,
    'mostly-clear': 0,
    'partly-cloudy': 0,
    overcast: 0,
    storm: 0,
  };
  let n = 0;
  let cloudSum = 0;
  let wetHours = 0;
  const dayRain = new Map<string, number>();
  const hod = Array.from({ length: 24 }, () => ({ n: 0, cloud: 0, clear: 0, dull: 0, wet: 0 }));
  for (const h of hours) {
    if (!Number.isFinite(h.cloudCoverTotal)) continue;
    const { hour, dateKey } = localParts(h.timestamp, meta.timeZone);
    {
      // Hour-of-day statistics cover the whole day; the window applies to the headline shares.
      const slot = hod[hour]!;
      const rainH = h.precipitationAmount ?? 0;
      const cls = scenarioForConditions(h.cloudCoverTotal, { precipitationAmount: rainH });
      slot.n++;
      slot.cloud += h.cloudCoverTotal;
      if (cls === 'clear' || cls === 'mostly-clear') slot.clear++;
      if (cls === 'overcast' || cls === 'storm') slot.dull++;
      if (rainH >= 0.1) slot.wet++;
    }
    if (hour < window.startHour || hour >= window.endHour) continue;
    n++;
    cloudSum += h.cloudCoverTotal;
    const rain = h.precipitationAmount ?? 0;
    if (rain >= 0.1) wetHours++;
    dayRain.set(dateKey, (dayRain.get(dateKey) ?? 0) + rain);
    const id = scenarioForConditions(h.cloudCoverTotal, { precipitationAmount: rain });
    counts[id] = (counts[id] ?? 0) + 1;
  }
  const share: Record<WeatherScenarioId, number> = {
    clear: 0,
    'mostly-clear': 0,
    'partly-cloudy': 0,
    overcast: 0,
    storm: 0,
  };
  for (const id of SCENARIO_IDS) share[id] = n > 0 ? (counts[id] ?? 0) / n : 0;
  const wetDays = [...dayRain.values()].filter((mm) => mm >= 1).length;
  return {
    kind: 'CLIMATOLOGY',
    providerId: meta.providerId,
    latitude: meta.latitude,
    longitude: meta.longitude,
    month: meta.month,
    timeZone: meta.timeZone,
    window,
    years: { from: meta.years.from, to: meta.years.to, count: meta.years.to - meta.years.from + 1 },
    sampleHours: n,
    scenarioShare: share,
    meanCloudCover: n > 0 ? cloudSum / n : 0,
    wetHourShare: n > 0 ? wetHours / n : 0,
    wetDayShare: dayRain.size > 0 ? wetDays / dayRain.size : 0,
    byHour: hod.map((s, hour) => ({
      hour,
      samples: s.n,
      meanCloudCover: s.n > 0 ? s.cloud / s.n : 0,
      clearShare: s.n > 0 ? s.clear / s.n : 0,
      dullShare: s.n > 0 ? s.dull / s.n : 0,
      wetShare: s.n > 0 ? s.wet / s.n : 0,
    })),
    attribution: meta.attribution,
    license: meta.license,
    label: 'Typical for this month',
  };
}

/**
 * The clearest and the dullest three-hour stretch of the day, by mean cloud over a centred
 * 3-hour average, restricted to hours with samples and to `window` when given. Null when the
 * spread is under 8 percentage points — then the day has no meaningful pattern and the UI must
 * not invent one.
 */
export function daylightPattern(
  summary: Pick<ClimatologySummary, 'byHour'>,
  window: ClimatologyWindow = DAYLIGHT_WINDOW,
): {
  clearest: { from: number; to: number; meanCloudCover: number };
  dullest: { from: number; to: number; meanCloudCover: number };
} | null {
  const candidates: Array<{ from: number; to: number; mean: number }> = [];
  for (let h = window.startHour; h + 3 <= window.endHour; h++) {
    const slots = [h, h + 1, h + 2].map((k) => summary.byHour[k]);
    if (slots.some((s) => !s || s.samples === 0)) continue;
    const mean = slots.reduce((acc, s) => acc + s!.meanCloudCover, 0) / 3;
    candidates.push({ from: h, to: h + 3, mean });
  }
  if (candidates.length < 2) return null;
  let lo = candidates[0]!;
  let hi = candidates[0]!;
  for (const c of candidates) {
    if (c.mean < lo.mean) lo = c;
    if (c.mean > hi.mean) hi = c;
  }
  if (hi.mean - lo.mean < 8) return null;
  return {
    clearest: { from: lo.from, to: lo.to, meanCloudCover: lo.mean },
    dullest: { from: hi.from, to: hi.to, meanCloudCover: hi.mean },
  };
}

/** The scenario the distribution suggests looking at first (largest share). Never applied silently. */
export function suggestedScenario(summary: ClimatologySummary): WeatherScenarioId {
  let best: WeatherScenarioId = 'partly-cloudy';
  let max = -1;
  for (const id of SCENARIO_IDS) {
    const v = summary.scenarioShare[id] ?? 0;
    if (v > max) {
      max = v;
      best = id;
    }
  }
  return best;
}

/**
 * Cache key: provider, ~0.5° cell (climatology is smooth), month, year span, window and the zone
 * (the daylight window is local, so a cell straddling a zone boundary needs one row per zone).
 */
export function climatologyCacheKey(
  providerId: string,
  lat: number,
  lng: number,
  month: number,
  years: { from: number; to: number },
  window: ClimatologyWindow = DAYLIGHT_WINDOW,
  timeZone = 'UTC',
): string {
  const cell = `${(Math.round(lat * 2) / 2).toFixed(1)},${(Math.round(lng * 2) / 2).toFixed(1)}`;
  // `v2`: the summary gained `byHour`; rows written before that must not be served.
  return `v2:${providerId}:${cell}:m${month}:${years.from}-${years.to}:h${window.startHour}-${window.endHour}:${timeZone}`;
}

/** Fetch the same month for several years and summarise. Concurrency-limited; partial years are dropped. */
export async function buildMonthlyClimatology(
  provider: ClimatologyProvider,
  input: {
    latitude: number;
    longitude: number;
    month: number;
    timeZone: string;
    /** Last complete year to include (default: previous calendar year). */
    toYear: number;
    years?: number;
    window?: ClimatologyWindow;
    signal?: AbortSignal;
    concurrency?: number;
  },
): Promise<ClimatologySummary> {
  const caps = provider.getCapabilities();
  const count = Math.max(1, Math.min(input.years ?? caps.defaultYears, 30));
  const fromYear = Math.max(caps.earliestYear, input.toYear - count + 1);
  const yearsList = Array.from({ length: input.toYear - fromYear + 1 }, (_, i) => fromYear + i);
  const results: ClimatologyHour[][] = new Array<ClimatologyHour[]>(yearsList.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= yearsList.length) return;
      const y = yearsList[i]!;
      const opts = input.signal ? { signal: input.signal } : undefined;
      results[i] = await provider.getMonthHours(
        input.latitude,
        input.longitude,
        y,
        input.month,
        opts,
      );
    }
  };
  const width = Math.max(1, Math.min(input.concurrency ?? 3, yearsList.length));
  await Promise.all(Array.from({ length: width }, worker));
  const hours = results.flat();
  return summarizeClimatology(hours, {
    providerId: caps.providerId,
    latitude: input.latitude,
    longitude: input.longitude,
    month: input.month,
    timeZone: input.timeZone,
    years: { from: fromYear, to: input.toYear },
    ...(input.window ? { window: input.window } : {}),
    attribution: caps.attribution,
    license: caps.license,
  });
}

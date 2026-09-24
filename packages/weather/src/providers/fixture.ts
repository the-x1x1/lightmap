/**
 * Fixture weather (plan §33): deterministic, labelled, development/test only. Generates a
 * plausible diurnal cloud pattern from a seed derived from the location and day so the same
 * inputs always give the same frames. `isFixture: true` makes the UI show the development banner;
 * env validation refuses it in production.
 */
import type {
  WeatherCapabilities,
  WeatherFrame,
  WeatherProvider,
  WeatherSeries,
} from '../model.ts';

export const FIXTURE_CAPABILITIES: WeatherCapabilities = {
  providerId: 'fixture',
  maxHorizonHours: 16 * 24,
  reliableHorizonHours: 7 * 24,
  historicalDays: 30,
  hasCloudLayers: true,
  hasIrradiance: false,
  hasVisibility: true,
  updateIntervalMinutes: 60,
  isFixture: true,
  attribution: 'Development fixture weather — not a forecast',
  license: 'Proprietary (LightMap test data)',
  commercialReview: 'development-only',
};

/** Small deterministic PRNG (mulberry32) so fixtures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FixturePattern = 'diurnal' | 'clear' | 'overcast' | 'storm';

export class FixtureWeatherProvider implements WeatherProvider {
  private readonly pattern: FixturePattern;
  private readonly now: () => Date;
  constructor(opts: { pattern?: FixturePattern; now?: () => Date } = {}) {
    this.pattern = opts.pattern ?? 'diurnal';
    this.now = opts.now ?? (() => new Date());
  }

  getCapabilities(): WeatherCapabilities {
    return FIXTURE_CAPABILITIES;
  }

  async getForecast(lat: number, lng: number, from: Date, to: Date): Promise<WeatherSeries> {
    const frames: WeatherFrame[] = [];
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) + 86_400_000,
    );
    for (let t = start.getTime(); t < end.getTime(); t += 3_600_000)
      frames.push(this.frameAt(new Date(t), lat, lng));
    return {
      providerId: 'fixture',
      latitude: lat,
      longitude: lng,
      modelElevationM: null,
      timeZone: null,
      frames,
      issuedAt: this.now().toISOString(),
      fetchedAt: this.now().toISOString(),
      capabilities: FIXTURE_CAPABILITIES,
    };
  }

  async getHistorical(lat: number, lng: number, from: Date, to: Date): Promise<WeatherSeries> {
    return this.getForecast(lat, lng, from, to);
  }

  frameAt(t: Date, lat: number, lng: number): WeatherFrame {
    const day = Math.floor(t.getTime() / 86_400_000);
    const rnd = mulberry32(Math.round(lat * 100) * 7919 + Math.round(lng * 100) * 104_729 + day);
    const base = rnd() * 60; // day's baseline cloudiness
    const hour = t.getUTCHours();
    // Tropical-ish pattern: clearer mornings, afternoon build-up.
    const diurnal = 20 * Math.sin(((hour - 6) / 24) * Math.PI * 2);
    let total: number;
    let precip = 0;
    let code = 1;
    switch (this.pattern) {
      case 'clear':
        total = 5;
        code = 0;
        break;
      case 'overcast':
        total = 95;
        code = 3;
        break;
      case 'storm':
        total = 100;
        precip = 3;
        code = 63;
        break;
      case 'diurnal':
        total = Math.max(0, Math.min(100, base + diurnal + (rnd() - 0.5) * 15));
        code = total < 12 ? 0 : total < 40 ? 1 : total < 80 ? 2 : 3;
        break;
    }
    return {
      timestamp: t.toISOString(),
      cloudCoverTotal: Math.round(total),
      cloudCoverLow: Math.round(total * 0.4),
      cloudCoverMid: Math.round(total * 0.35),
      cloudCoverHigh: Math.round(total * 0.25),
      precipitationProbability: precip > 0 ? 90 : Math.round(total / 4),
      precipitationAmount: precip,
      humidity: Math.round(60 + total / 4),
      visibility: precip > 0 ? 6000 : 30000 - total * 100,
      windSpeed: 4,
      windDirection: 60,
      weatherCode: code,
      directNormalIrradiance: null,
      diffuseRadiation: null,
      shortwaveRadiation: null,
    };
  }
}

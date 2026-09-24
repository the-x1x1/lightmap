/**
 * Fixture climatology (development/tests): deterministic monthly hours generated from latitude and
 * month so the "Typical for this month" panel renders without network. Labelled a fixture; the env
 * validator refuses fixture providers in production.
 */
import type {
  ClimatologyCapabilities,
  ClimatologyHour,
  ClimatologyProvider,
} from '../climatology.ts';

export const FIXTURE_CLIMATOLOGY_CAPABILITIES: ClimatologyCapabilities = {
  providerId: 'fixture-climatology',
  earliestYear: 2000,
  defaultYears: 5,
  isFixture: true,
  attribution: 'Development fixture climatology — not real data',
  license: 'Proprietary (LightMap test data)',
  commercialReview: 'blocked',
};

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

export class FixtureClimatologyProvider implements ClimatologyProvider {
  getCapabilities(): ClimatologyCapabilities {
    return FIXTURE_CLIMATOLOGY_CAPABILITIES;
  }

  getMonthHours(lat: number, lng: number, year: number, month: number): Promise<ClimatologyHour[]> {
    const seed = Math.round(lat * 100) * 31 + Math.round(lng * 100) * 17 + year * 13 + month;
    const rnd = mulberry32(seed);
    // Cloudier toward the poles and in local winter; a wet-season bump for the tropics.
    const absLat = Math.abs(lat);
    const winter = lat >= 0 ? [11, 12, 1, 2].includes(month) : [5, 6, 7, 8].includes(month);
    const baseCloud = 25 + absLat * 0.6 + (winter ? 15 : 0);
    const wetChance = absLat < 23 && [11, 12, 1, 2, 3].includes(month) ? 0.18 : 0.06;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const out: ClimatologyHour[] = [];
    for (let d = 1; d <= days; d++) {
      const dayOffset = (rnd() - 0.5) * 60; // some days are clear, some overcast
      for (let h = 0; h < 24; h++) {
        const diurnal = 10 * Math.sin(((h - 6) / 24) * 2 * Math.PI); // afternoon build-up
        const cloud = Math.max(
          0,
          Math.min(100, baseCloud + dayOffset + diurnal + (rnd() - 0.5) * 20),
        );
        const wet = rnd() < wetChance * (cloud / 100);
        out.push({
          timestamp: new Date(Date.UTC(year, month - 1, d, h)).toISOString(),
          cloudCoverTotal: cloud,
          precipitationAmount: wet ? 0.5 + rnd() * 3 : 0,
        });
      }
    }
    return Promise.resolve(out);
  }
}

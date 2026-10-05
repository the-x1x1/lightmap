import { describe, expect, it } from 'vitest';
import { OPEN_METEO_CAPABILITIES } from '@lightmap/weather';
import { forecastNudge } from '@/features/projects/forecast-nudge';

const now = new Date('2026-05-25T00:00:00Z');
const at = (daysFromNow: number) =>
  new Date(now.getTime() + daysFromNow * 86_400_000).toISOString();

describe('forecast nudge on saved viewpoints (North Star: the forecast becomes specific)', () => {
  it('a scenario-saved shoot now inside the reliable horizon says the forecast is available', () => {
    const n = forecastNudge(
      { selectedDatetimeUtc: at(3), weatherMode: 'SCENARIO' },
      OPEN_METEO_CAPABILITIES,
      now,
    );
    expect(n?.kind).toBe('forecast');
  });
  it('is quiet when the viewpoint already carried the forecast, or is still too far out', () => {
    expect(
      forecastNudge(
        { selectedDatetimeUtc: at(3), weatherMode: 'FORECAST' },
        OPEN_METEO_CAPABILITIES,
        now,
      ),
    ).toBeNull();
    expect(
      forecastNudge(
        { selectedDatetimeUtc: at(40), weatherMode: 'SCENARIO' },
        OPEN_METEO_CAPABILITIES,
        now,
      ),
    ).toBeNull();
  });
  it('names the extended range with its low confidence', () => {
    expect(
      forecastNudge(
        { selectedDatetimeUtc: at(10), weatherMode: 'SCENARIO' },
        OPEN_METEO_CAPABILITIES,
        now,
      )?.kind,
    ).toBe('extended');
  });
  it('a passed date says so, and that observed conditions are there when the archive has them', () => {
    const recent = forecastNudge(
      { selectedDatetimeUtc: at(-2), weatherMode: 'FORECAST' },
      OPEN_METEO_CAPABILITIES,
      now,
    );
    expect(recent?.kind).toBe('past');
    expect(recent?.text).toContain('observed');
    const ancient = forecastNudge(
      { selectedDatetimeUtc: '1900-06-01T00:00:00Z', weatherMode: 'SCENARIO' },
      OPEN_METEO_CAPABILITIES,
      now,
    );
    expect(ancient?.text).toBe('Date has passed');
  });
  it('nothing without weather capabilities', () => {
    expect(
      forecastNudge({ selectedDatetimeUtc: at(1), weatherMode: 'SCENARIO' }, null, now),
    ).toBeNull();
  });
});

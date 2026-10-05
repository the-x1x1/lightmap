import { describe, expect, it } from 'vitest';
import type { WeatherFrame } from '@lightmap/weather';
import {
  describeWind,
  fieldConditions,
  formatVisibility,
  formatWindSpeed,
  isFog,
  moistureRisk,
  windStrength,
} from '../src/field-conditions.ts';

function frame(over: Partial<WeatherFrame> = {}): WeatherFrame {
  return {
    timestamp: '2026-06-13T06:00:00.000Z',
    cloudCoverTotal: 20,
    cloudCoverLow: 10,
    cloudCoverMid: 5,
    cloudCoverHigh: 5,
    precipitationProbability: 5,
    precipitationAmount: 0,
    humidity: 70,
    visibility: 24_000,
    windSpeed: 4,
    windDirection: 60,
    weatherCode: 1,
    ...over,
  };
}

describe('wind (Beaufort bands)', () => {
  it('names the bands at their lower bounds', () => {
    expect(windStrength(0)).toBe('calm');
    expect(windStrength(0.4)).toBe('calm');
    expect(windStrength(0.5)).toBe('light');
    expect(windStrength(3.3)).toBe('light');
    expect(windStrength(3.4)).toBe('moderate');
    expect(windStrength(7.9)).toBe('moderate');
    expect(windStrength(8)).toBe('fresh');
    expect(windStrength(10.7)).toBe('fresh');
    expect(windStrength(10.8)).toBe('strong');
    expect(windStrength(13.8)).toBe('strong');
    expect(windStrength(13.9)).toBe('near-gale');
    expect(windStrength(17.1)).toBe('near-gale');
    expect(windStrength(17.2)).toBe('gale');
    expect(windStrength(30)).toBe('gale');
  });

  it('formats the speed in the chosen units, whole numbers', () => {
    expect(formatWindSpeed(4)).toBe('4 m/s');
    expect(formatWindSpeed(4, 'imperial')).toBe('9 mph');
    expect(formatWindSpeed(13.4, 'imperial')).toBe('30 mph');
  });

  it('describes the quarter it blows from, and calm air without one', () => {
    expect(describeWind(4, 60)).toEqual({
      label: 'Wind',
      value: '4 m/s from the ENE',
      note: null,
    });
    expect(describeWind(4, 60, 'imperial').value).toBe('9 mph from the ENE');
    expect(describeWind(4, null).value).toBe('4 m/s');
    expect(describeWind(0.2, 180)).toEqual({ label: 'Wind', value: 'calm', note: null });
  });

  it('warns from a fresh breeze up', () => {
    expect(describeWind(9, 270).note).toMatch(/^fresh — weigh the tripod down/);
    expect(describeWind(12, 270).note).toMatch(/^strong — tripod shake likely/);
    expect(describeWind(15, 270).note).toMatch(/^near gale — a weighted tripod/);
    expect(describeWind(20, 270).note).toMatch(/^gale — hand-held only/);
  });
});

describe('visibility', () => {
  it('metric: metres, then a tenth of a kilometre, then whole kilometres', () => {
    expect(formatVisibility(600)).toBe('600 m');
    expect(formatVisibility(4_500)).toBe('4.5 km');
    expect(formatVisibility(24_000)).toBe('24 km');
    // No "1000 m" and no "10.0 km" at the steps.
    expect(formatVisibility(999.4)).toBe('999 m');
    expect(formatVisibility(999.6)).toBe('1.0 km');
    expect(formatVisibility(9_949)).toBe('9.9 km');
    expect(formatVisibility(9_950)).toBe('10 km');
  });
  it('imperial: feet (to ten in fog, to a hundred above a thousand) below half a mile, then miles', () => {
    expect(formatVisibility(12, 'imperial')).toBe('40 ft');
    expect(formatVisibility(600, 'imperial')).toBe('2000 ft');
    expect(formatVisibility(804, 'imperial')).toBe('2600 ft');
    expect(formatVisibility(805, 'imperial')).toBe('0.5 mi');
    expect(formatVisibility(4_500, 'imperial')).toBe('2.8 mi');
    expect(formatVisibility(16_000, 'imperial')).toBe('9.9 mi');
    expect(formatVisibility(16_020, 'imperial')).toBe('10 mi');
    expect(formatVisibility(24_000, 'imperial')).toBe('15 mi');
  });
});

describe('moisture on the glass', () => {
  it('fog is a fog code, or visibility under a kilometre with nothing falling', () => {
    expect(isFog(frame({ visibility: 999 }))).toBe(true);
    expect(isFog(frame({ visibility: 999, weatherCode: null }))).toBe(true);
    expect(isFog(frame({ visibility: 1000 }))).toBe(false);
    expect(isFog(frame({ weatherCode: 45 }))).toBe(true);
    expect(isFog(frame({ weatherCode: 48, visibility: null }))).toBe(true);
    // Heavy rain or snow cuts the view too; that is not fog.
    expect(isFog(frame({ visibility: 500, weatherCode: 65 }))).toBe(false);
    expect(isFog(frame({ visibility: 500, weatherCode: 75 }))).toBe(false);
    expect(moistureRisk(frame({ visibility: 500, humidity: 60 }), 30)).toBe('fog');
    expect(moistureRisk(frame({ weatherCode: 45, humidity: null }), 30)).toBe('fog');
  });

  it('near saturation: dew at night, mist by day', () => {
    expect(moistureRisk(frame({ humidity: 95 }), -1)).toBe('dew-likely');
    expect(moistureRisk(frame({ humidity: 98, cloudCoverTotal: 100, windSpeed: 12 }), -20)).toBe(
      'dew-likely',
    );
    expect(moistureRisk(frame({ humidity: 95 }), 0)).toBe('mist');
    expect(moistureRisk(frame({ humidity: 97 }), 40)).toBe('mist');
    expect(moistureRisk(frame({ humidity: 94 }), 40)).toBeNull();
  });

  it('dew is possible only on a calm, mostly clear night above 85 %', () => {
    const night = frame({ humidity: 88, windSpeed: 1, cloudCoverTotal: 20 });
    expect(moistureRisk(night, -10)).toBe('dew-possible');
    expect(moistureRisk(night, 10)).toBeNull(); // by day the surface is warming
    expect(moistureRisk({ ...night, windSpeed: 3.4 }, -10)).toBeNull(); // Beaufort 3 stirs the air
    expect(moistureRisk({ ...night, windSpeed: null }, -10)).toBeNull(); // unknown wind: no claim
    expect(moistureRisk({ ...night, cloudCoverTotal: 51 }, -10)).toBeNull(); // cloud holds the heat
    expect(moistureRisk({ ...night, humidity: 84 }, -10)).toBeNull();
    expect(moistureRisk({ ...night, humidity: null }, -10)).toBeNull();
  });
});

describe('fieldConditions', () => {
  it('gives nothing for a scenario (no frame)', () => {
    expect(fieldConditions(null, 30)).toEqual([]);
  });

  it('lists the wind and the humidity with their notes', () => {
    expect(fieldConditions(frame(), 30)).toEqual([
      { label: 'Wind', value: '4 m/s from the ENE', note: null },
      { label: 'Humidity', value: '70 %', note: null },
    ]);
    const lines = fieldConditions(frame({ humidity: 97, windSpeed: 10 }), -15, 'imperial');
    expect(lines[0]?.value).toBe('22 mph from the ENE');
    expect(lines[0]?.note).toMatch(/^fresh/);
    expect(lines[1]).toEqual({
      label: 'Humidity',
      value: '97 %',
      note: 'near saturation — dew on the glass is likely; a lens warmer or a deep hood helps',
    });
    expect(fieldConditions(frame({ visibility: 300 }), 5)[1]?.note).toMatch(/^fog — lenses mist/);
    expect(fieldConditions(frame({ humidity: 96 }), 20)[1]?.note).toMatch(
      /^near saturation — mist/,
    );
    expect(fieldConditions(frame({ humidity: 88, windSpeed: 1 }), -5)[1]?.note).toMatch(
      /^a calm, mostly clear night this humid/,
    );
  });

  it('leaves out a line whose field the frame lacks', () => {
    expect(fieldConditions(frame({ windSpeed: null }), 30).map((l) => l.label)).toEqual([
      'Humidity',
    ]);
    expect(fieldConditions(frame({ humidity: null }), 30).map((l) => l.label)).toEqual(['Wind']);
    expect(fieldConditions(frame({ humidity: null, windSpeed: null }), 30)).toEqual([]);
  });
});

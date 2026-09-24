import { describe, expect, it } from 'vitest';
import { formatCoordinates, parseCoordinates } from '../src/coordinates.ts';

describe('parseCoordinates', () => {
  it('parses decimal pairs in several spellings', () => {
    expect(parseCoordinates('21.397, -157.727')).toEqual({ latitude: 21.397, longitude: -157.727 });
    expect(parseCoordinates('21.397 -157.727')).toEqual({ latitude: 21.397, longitude: -157.727 });
    expect(parseCoordinates('21.397N, 157.727W')).toEqual({ latitude: 21.397, longitude: -157.727 });
    expect(parseCoordinates('-33.8688;151.2093')).toEqual({ latitude: -33.8688, longitude: 151.2093 });
  });

  it('parses DMS pairs', () => {
    const p = parseCoordinates(`21°23'49"N 157°43'37"W`);
    expect(p).not.toBeNull();
    expect(p!.latitude).toBeCloseTo(21.3969, 3);
    expect(p!.longitude).toBeCloseTo(-157.7269, 3);
  });

  it('parses a Google Maps URL fragment', () => {
    expect(parseCoordinates('https://www.google.com/maps/@21.397,-157.727,15z')).toEqual({ latitude: 21.397, longitude: -157.727 });
  });

  it('rejects place names and out-of-range values', () => {
    expect(parseCoordinates('Kailua Beach')).toBeNull();
    expect(parseCoordinates('95, 10')).toBeNull();
    expect(parseCoordinates('')).toBeNull();
  });

  it('formats with hemispheres', () => {
    expect(formatCoordinates({ latitude: 21.397, longitude: -157.727 })).toBe('21.3970° N, 157.7270° W');
  });
});

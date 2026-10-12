import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  parsePreferencesPatch,
} from '@/lib/preferences';

describe('preferences (plan §17)', () => {
  it('accepts any subset of valid fields and ignores unknown keys', () => {
    expect(parsePreferencesPatch({ units: 'imperial' })).toEqual({ units: 'imperial' });
    expect(
      parsePreferencesPatch({
        defaultTimezoneBehavior: 'device',
        defaultLensEquivalentMm: 35,
        email: 'x@y',
      }),
    ).toEqual({ defaultTimezoneBehavior: 'device', defaultLensEquivalentMm: 35 });
    expect(parsePreferencesPatch({ paintedGround: false })).toEqual({ paintedGround: false });
  });
  it('rejects bad values with a readable message', () => {
    expect(() => parsePreferencesPatch({ units: 'furlongs' })).toThrow(/units must be one of/);
    expect(() => parsePreferencesPatch({ defaultTimezoneBehavior: 'UTC' })).toThrow(
      /defaultTimezoneBehavior/,
    );
    expect(() => parsePreferencesPatch({ defaultLensEquivalentMm: 24.5 })).toThrow(/whole number/);
    expect(() => parsePreferencesPatch({ defaultLensEquivalentMm: 2000 })).toThrow(/between 8/);
    expect(() => parsePreferencesPatch({ defaultLensEquivalentMm: '24' })).toThrow(/whole number/);
    expect(() => parsePreferencesPatch({ paintedGround: 'no' })).toThrow(/true or false/);
    expect(() => parsePreferencesPatch({})).toThrow(/nothing to change/);
    expect(() => parsePreferencesPatch(null)).toThrow(/object/);
    expect(() => parsePreferencesPatch([])).toThrow(/object/);
  });
  it('normalises a stale or partial stored object from the defaults', () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences({ units: 'imperial', defaultLensEquivalentMm: 4 })).toEqual({
      ...DEFAULT_PREFERENCES,
      units: 'imperial',
    });
    expect(normalizePreferences({ defaultTimezoneBehavior: 'device' })).toEqual({
      ...DEFAULT_PREFERENCES,
      defaultTimezoneBehavior: 'device',
    });
    // A profile saved before the painted-ground preference existed reads as painted.
    expect(normalizePreferences({ units: 'metric' }).paintedGround).toBe(true);
    expect(normalizePreferences({ paintedGround: false }).paintedGround).toBe(false);
    expect(normalizePreferences({ paintedGround: 'off' }).paintedGround).toBe(true);
  });
});

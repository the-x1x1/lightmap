import { describe, expect, it } from 'vitest';
import { cloudCoverAtSave } from '../../lib/saved-cloud.ts';

describe('cloudCoverAtSave', () => {
  it('reads the frame the snapshot was saved with, whole percent, clamped', () => {
    expect(cloudCoverAtSave({ frame: { cloudCoverTotal: 42.6 } })).toBe(43);
    expect(cloudCoverAtSave({ frame: { cloudCoverTotal: 120 } })).toBe(100);
    expect(cloudCoverAtSave({ frame: { cloudCoverTotal: -3 } })).toBe(0);
  });
  it('is null for a scenario day, an older snapshot or junk', () => {
    expect(cloudCoverAtSave({ frame: null, mode: 'SCENARIO' })).toBeNull();
    expect(cloudCoverAtSave({})).toBeNull();
    expect(cloudCoverAtSave(undefined)).toBeNull();
    expect(cloudCoverAtSave('x')).toBeNull();
    expect(cloudCoverAtSave({ frame: { cloudCoverTotal: 'many' } })).toBeNull();
    expect(cloudCoverAtSave({ frame: { cloudCoverTotal: Number.NaN } })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { nightTag } from '../../features/projects/night-tag.ts';

const KAILUA = { latitude: 21.397, longitude: -157.727 };

describe('night tag on a saved viewpoint', () => {
  it('names the core and the sky for night shots only', () => {
    // New-Moon night, 02:00 HST: dark, core up in the SSW.
    const dark = nightTag({ ...KAILUA, selectedDatetimeUtc: '2026-06-15T12:00:00Z' });
    expect(dark?.verdict).toBe('visible');
    expect(dark?.text).toMatch(/^Milky Way core 3\d° up S(SW|W) · dark sky$/);
    // Full-Moon night: the core is up but washed out.
    const moonlit = nightTag({ ...KAILUA, selectedDatetimeUtc: '2026-05-31T12:00:00Z' });
    expect(moonlit?.verdict).toBe('moonlit');
    expect(moonlit?.text).toMatch(/· Moon (9\d|100) % lit$/);
    // Winter midnight: below the horizon, no state suffix.
    const winter = nightTag({ ...KAILUA, selectedDatetimeUtc: '2026-12-15T10:00:00Z' });
    expect(winter?.verdict).toBe('below-horizon');
    expect(winter?.text).toBe('Milky Way core below the horizon');
    // Noon and an unparsable instant: no line.
    expect(nightTag({ ...KAILUA, selectedDatetimeUtc: '2026-06-15T22:30:00Z' })).toBeNull();
    expect(nightTag({ ...KAILUA, selectedDatetimeUtc: 'not a date' })).toBeNull();
  });
});

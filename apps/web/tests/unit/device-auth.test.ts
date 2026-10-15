import { describe, expect, it } from 'vitest';
import {
  bearerDeviceToken,
  cleanDeviceName,
  newLinkCode,
  normaliseLinkCode,
  sha256,
} from '../../lib/server/device-auth.ts';

describe('desktop sign-in helpers', () => {
  it('makes readable link codes and accepts them however they are typed', () => {
    const code = newLinkCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code).not.toMatch(/[01ILOUV]/);
    expect(normaliseLinkCode(code.toLowerCase().replace('-', ' '))).toBe(code);
    expect(normaliseLinkCode('ABCD-EFG')).toBeNull();
    expect(normaliseLinkCode('ABCD-EFG0')).toBeNull(); // 0 is not in the alphabet
  });

  it('only takes device tokens from an Authorization header', () => {
    const token = 'lmd_' + 'x'.repeat(43);
    expect(bearerDeviceToken(`Bearer ${token}`)).toBe(token);
    expect(bearerDeviceToken(`bearer ${token}`)).toBe(token);
    expect(bearerDeviceToken('Bearer sk_live_something_else_entirely')).toBeNull();
    expect(bearerDeviceToken('Basic abc')).toBeNull();
    expect(bearerDeviceToken(null)).toBeNull();
  });

  it('hashes, and names devices printably', () => {
    expect(sha256('a')).toHaveLength(64);
    expect(cleanDeviceName('Studio <Mac>\n')).toBe('Studio Mac');
    expect(cleanDeviceName('')).toBe('LightMap desktop');
    expect(cleanDeviceName('x'.repeat(100))).toHaveLength(60);
  });
});

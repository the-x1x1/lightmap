import { describe, expect, it } from 'vitest';
import {
  bearerDeviceToken,
  cleanDeviceName,
  networkKey,
  newLinkCode,
  normaliseLinkCode,
  sameNetwork,
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

  it('keys a request by its network, not its address (device-code phishing)', () => {
    const req = (xff?: string) =>
      new Request('http://x/', { headers: xff ? { 'x-forwarded-for': xff } : {} });
    const home = networkKey(req('198.51.100.23, 10.0.0.1'), 's');
    expect(home).toMatch(/^[0-9a-f]{32}$/);
    expect(home).not.toContain('198');
    expect(networkKey(req('198.51.100.200'), 's')).toBe(home); // same /24
    expect(networkKey(req('198.51.101.23'), 's')).not.toBe(home);
    expect(networkKey(req('::ffff:198.51.100.9'), 's')).toBe(home);
    expect(networkKey(req('2001:db8:aa:1::5'), 's')).toBe(
      networkKey(req('2001:db8:aa:ff::9'), 's'),
    );
    expect(networkKey(req(), 's')).toBeNull();
    expect(networkKey(req('198.51.100.23'), 'other')).not.toBe(home);
    expect(sameNetwork(home, home)).toBe(true);
    expect(sameNetwork(null, null)).toBe(true); // a computer serving itself
    expect(sameNetwork(home, null)).toBe(false);
    expect(sameNetwork(null, home)).toBe(false);
  });
});

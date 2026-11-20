import { describe, expect, it } from 'vitest';
import {
  ADDRESS_BURST_FACTOR,
  BurstExceeded,
  addressKey,
  anonymousKey,
  clientAddress,
  createBurstWindows,
} from '../../lib/server/burst.ts';

const from = (h: Record<string, string>) => new Headers(h);

describe('burst limiter', () => {
  it('lets a key through up to its limit in a minute, then refuses until the window moves', () => {
    const w = createBurstWindows();
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) w.check('weather:a', 30, t0 + i * 100);
    expect(() => w.check('weather:a', 30, t0 + 4000)).toThrow(BurstExceeded);
    // Another key, and the same client on another route, have windows of their own.
    expect(() => w.check('weather:b', 30, t0 + 4000)).not.toThrow();
    expect(() => w.check('search:a', 30, t0 + 4000)).not.toThrow();
    // A refused request is not counted: a minute after the first, one is let through again.
    expect(() => w.check('weather:a', 30, t0 + 59_999)).toThrow(BurstExceeded);
    expect(() => w.check('weather:a', 30, t0 + 60_000)).not.toThrow();
    expect(() => w.check('weather:a', 30, t0 + 60_001)).toThrow(BurstExceeded);
  });

  it('counts a client that renames its browser under its address all the same', () => {
    const salt = 's';
    const a = from({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'one' });
    const b = from({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'two' });
    const other = from({ 'x-forwarded-for': '203.0.113.8', 'user-agent': 'one' });
    // Its own key changes with the User-Agent; its address's does not.
    expect(anonymousKey(a, salt)).not.toBe(anonymousKey(b, salt));
    expect(addressKey(a, salt)).toBe(addressKey(b, salt));
    expect(addressKey(a, salt)).not.toBe(addressKey(other, salt));
    expect(addressKey(a, salt)).toMatch(/^n:[0-9a-f]{24}$/);
    expect(anonymousKey(a, salt)).toMatch(/^a:[0-9a-f]{24}$/);
    // Neither holds the address, and another salt gives other keys.
    expect(addressKey(a, salt)).not.toContain('203');
    expect(addressKey(a, 'other')).not.toBe(addressKey(a, salt));
    // So a flood under ever-new names stops at the address's window.
    const w = createBurstWindows();
    const limit = 30;
    let passed = 0;
    for (let i = 0; i < 1000; i++) {
      const h = from({ 'x-forwarded-for': '203.0.113.7', 'user-agent': `name-${i}` });
      try {
        w.check(`weather:${addressKey(h, salt)}`, limit * ADDRESS_BURST_FACTOR, 5000 + i);
        w.check(`weather:${anonymousKey(h, salt)}`, limit, 5000 + i);
        passed++;
      } catch (error) {
        expect(error).toBeInstanceOf(BurstExceeded);
      }
    }
    expect(passed).toBe(limit * ADDRESS_BURST_FACTOR);
  });

  it('keys an IPv6 client by its /64 and reads a mapped IPv4 address as IPv4', () => {
    const k = (ip: string) => addressKey(from({ 'x-forwarded-for': ip }), 's');
    expect(k('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(k('2001:DB8:1:2:1:2:3:4'));
    expect(k('2001:db8:1:2::1')).not.toBe(k('2001:db8:1:3::1'));
    expect(k('::ffff:203.0.113.7')).not.toBe(k('::ffff:203.0.113.8'));
  });

  it('has no address key where nothing reports the address', () => {
    expect(clientAddress(from({}))).toBeNull();
    expect(addressKey(from({ 'user-agent': 'x' }), 's')).toBeNull();
    expect(clientAddress(from({ 'x-real-ip': ' 198.51.100.2 ' }))).toBe('198.51.100.2');
    expect(clientAddress(from({ 'x-forwarded-for': '' }))).toBeNull();
    // A header too long to be an address is not one.
    expect(clientAddress(from({ 'x-forwarded-for': 'x'.repeat(65) }))).toBeNull();
    // The client's own key still exists (every such client shares it, as before).
    expect(anonymousKey(from({}), 's')).toMatch(/^a:/);
  });

  it('keeps at most its cap of windows, dropping the expired and then the least recently used', () => {
    const w = createBurstWindows(100);
    for (let i = 0; i < 100; i++) w.check(`k${i}`, 5, 1000 + i);
    expect(w.size).toBe(100);
    // k0 is used again, so it is no longer the oldest.
    w.check('k0', 5, 2000);
    // A flood of new keys: the map does not grow.
    for (let i = 0; i < 5000; i++) w.check(`flood${i}`, 5, 3000 + i);
    expect(w.size).toBe(100);
    // Once every old window has expired, a sweep clears them at once.
    const w2 = createBurstWindows(10);
    for (let i = 0; i < 10; i++) w2.check(`old${i}`, 5, 0);
    w2.check('new', 5, 120_000);
    expect(w2.size).toBe(1);
    // A key at its limit that is dropped under a flood starts afresh: the cap trades that for
    // bounded memory, and the address's window - far fewer keys - is the one that holds.
    const w3 = createBurstWindows(2);
    w3.check('a', 1, 0);
    expect(() => w3.check('a', 1, 1)).toThrow(BurstExceeded);
    w3.check('b', 1, 2);
    w3.check('c', 1, 3);
    expect(w3.size).toBe(2);
  });
});

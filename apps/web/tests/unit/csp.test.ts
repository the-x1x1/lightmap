import { describe, expect, it } from 'vitest';
import { buildCsp, extraImageryHosts } from '@/lib/csp';

describe('CSP builder', () => {
  it('never widens an apex domain to a whole TLD', () => {
    expect(extraImageryHosts('https://example.com/{z}/{x}/{y}.png')).toEqual([
      'https://example.com',
    ]);
    expect(extraImageryHosts('https://a.tiles.example.com/{z}/{x}/{y}.png')).toEqual([
      'https://a.tiles.example.com',
      'https://*.tiles.example.com',
    ]);
    expect(extraImageryHosts(undefined)).toEqual([]);
    expect(extraImageryHosts('not a url')).toEqual([]);
  });
  it('production policy has a nonce and strict-dynamic and no unsafe-inline/unsafe-eval scripts', () => {
    const csp = buildCsp('abc123', false);
    expect(csp).toContain(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic' 'wasm-unsafe-eval' blob:",
    );
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp.split(';').find((d) => d.trim().startsWith('script-src'))).not.toContain(
      "'unsafe-inline'",
    );
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain('https://terrain.reearth.land');
    expect(csp).toContain('upgrade-insecure-requests');
  });
  it('development allows eval and websockets for HMR', () => {
    const csp = buildCsp('n', true);
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws: wss:');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

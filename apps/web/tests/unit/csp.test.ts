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
  it('the operator’s imagery and land-cover tile hosts are allowed for images and fetches', () => {
    const csp = buildCsp('n', false, {
      IMAGERY_XYZ_URL: 'https://tiles.example.com/{z}/{x}/{y}.png',
      LANDCOVER_XYZ_URL:
        'https://services.terrascope.be/wmts/v2?layer=WORLDCOVER_2021_MAP&TileMatrix={z}&TileCol={x}&TileRow={y}',
    });
    const img = csp.split(';').find((d) => d.trim().startsWith('img-src'))!;
    const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src'))!;
    for (const h of [
      'https://tiles.example.com',
      'https://services.terrascope.be',
      'https://*.terrascope.be',
    ]) {
      expect(img).toContain(h);
      expect(connect).toContain(h);
    }
    // The same host for both is listed once.
    const both = buildCsp('n', false, {
      IMAGERY_XYZ_URL: 'https://t.example.org/{z}/{x}/{y}.png',
      LANDCOVER_XYZ_URL: 'https://t.example.org/lc/{z}/{x}/{y}.png',
    });
    expect(both.split('https://t.example.org').length - 1).toBe(2); // img-src and connect-src
    expect(buildCsp('n', false, {})).not.toContain('example');
  });
  it('development allows eval and websockets for HMR', () => {
    const csp = buildCsp('n', true);
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws: wss:');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

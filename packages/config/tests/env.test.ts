import { describe, expect, it } from 'vitest';
import { envCapabilities, parseEnv } from '../src/env.ts';

describe('parseEnv', () => {
  it('accepts an empty development environment with defaults', () => {
    const r = parseEnv({});
    expect(r.ok).toBe(true);
    expect(r.env.NODE_ENV).toBe('development');
    expect(r.env.WEATHER_PROVIDER).toBe('open-meteo');
    expect(r.env.LIGHTMAP_SHOW_DEV_BANNER).toBe(true);
  });

  it('rejects unknown enum values', () => {
    const r = parseEnv({ WEATHER_PROVIDER: 'weather-channel' });
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.key).toBe('WEATHER_PROVIDER');
  });

  it('refuses dev login and fixture providers in production', () => {
    const r = parseEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      AUTH_SECRET: 'a'.repeat(40),
      AUTH_URL: 'https://app.example.com',
      EMAIL_SERVER: 'smtp://x',
      AUTH_DEV_LOGIN: 'true',
      WEATHER_PROVIDER: 'fixture',
    });
    expect(r.ok).toBe(false);
    const keys = r.issues.filter((i) => i.severity === 'error').map((i) => i.key);
    expect(keys).toContain('AUTH_DEV_LOGIN');
    expect(keys).toContain('WEATHER_PROVIDER');
  });

  it('requires a token for ion providers and attribution for xyz imagery', () => {
    const r = parseEnv({ TERRAIN_PROVIDER: 'cesium-ion', IMAGERY_PROVIDER: 'xyz', IMAGERY_XYZ_URL: 'https://t/{z}/{x}/{y}.png' });
    const keys = r.issues.map((i) => i.key);
    expect(keys).toContain('CESIUM_ION_TOKEN');
    expect(keys).toContain('IMAGERY_XYZ_ATTRIBUTION');
  });

  it('flags test-mode Stripe keys in production', () => {
    const r = parseEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec' });
    expect(r.issues.some((i) => i.key === 'STRIPE_SECRET_KEY' && i.severity === 'error')).toBe(true);
  });

  it('reports fixture mode when any live provider is missing', () => {
    const caps = envCapabilities(parseEnv({}).env);
    expect(caps.fixtureMode).toBe(true); // natural-earth imagery is coarse ⇒ limited mode
    expect(caps.referenceImagery).toBe(false);
    const live = envCapabilities(parseEnv({ IMAGERY_PROVIDER: 'xyz', IMAGERY_XYZ_URL: 'https://t', IMAGERY_XYZ_ATTRIBUTION: 'x' }).env);
    expect(live.fixtureMode).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { WEATHER_RECOVERY_MS, weatherRecoveryInterval } from '@/features/planner/weather-query';
import { ApiRequestError } from '@/lib/client/api';

const failed = (error: unknown) => ({ state: { status: 'error', error } });

describe('the planner’s weather after a failure', () => {
  it('asks again every minute after an outage', () => {
    // The route's own answer when the provider is down, and a network failure in the browser.
    const down = new ApiRequestError(502, { code: 'weather_unavailable', message: 'down' });
    expect(weatherRecoveryInterval(failed(down))).toBe(WEATHER_RECOVERY_MS);
    expect(weatherRecoveryInterval(failed(new TypeError('Failed to fetch')))).toBe(60_000);
  });

  it('takes a refusal as an answer', () => {
    const window = new ApiRequestError(403, { code: 'plan_window', message: 'Pro' });
    const bad = new ApiRequestError(400, { code: 'bad_request', message: 'lat' });
    expect(weatherRecoveryInterval(failed(window))).toBe(false);
    expect(weatherRecoveryInterval(failed(bad))).toBe(false);
  });

  it('leaves a query that has its weather, or is fetching it, alone', () => {
    expect(weatherRecoveryInterval({ state: { status: 'success', error: null } })).toBe(false);
    expect(weatherRecoveryInterval({ state: { status: 'pending', error: null } })).toBe(false);
  });
});

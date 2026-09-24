import { describe, expect, it } from 'vitest';
import {
  createLogger,
  quantizeForAnalytics,
  redact,
  sanitizeAnalyticsProps,
} from '../src/index.ts';

describe('logger', () => {
  it('emits JSON lines at or above the level with redaction', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', write: (l) => lines.push(l), now: () => 'T' }).child({
      service: 'api',
    });
    log.debug('hidden');
    log.info('hello', {
      apiKey: 'secret',
      nested: { password: 'x', ok: 1 },
      err: new Error('boom'),
    });
    expect(lines).toHaveLength(1);
    const j = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(j).toMatchObject({
      time: 'T',
      level: 'info',
      message: 'hello',
      service: 'api',
      apiKey: '[redacted]',
      nested: { password: '[redacted]', ok: 1 },
      err: { message: 'boom' },
    });
    expect(redact({ Authorization: 'Bearer x' })).toEqual({ Authorization: '[redacted]' });
    // Cycles and BigInts are caller mistakes the logger survives.
    const cyclic: Record<string, unknown> = { n: 1n };
    cyclic['self'] = cyclic;
    expect(redact(cyclic)).toEqual({ n: '1', self: '[circular]' });
  });
});

describe('analytics privacy', () => {
  it('quantises coordinates to whole degrees and drops precise/freeform props', () => {
    expect(quantizeForAnalytics(21.397, -157.727)).toEqual({ latBucket: 21, lngBucket: -158 });
    expect(
      sanitizeAnalyticsProps({
        latitude: 21.397,
        lng: -157.7,
        scenario: 'overcast',
        notes: 'secret shoot',
        query: 'Kailua',
        latBucket: 21,
        long: 'x'.repeat(100),
      }),
    ).toEqual({ scenario: 'overcast', latBucket: 21 });
  });
});

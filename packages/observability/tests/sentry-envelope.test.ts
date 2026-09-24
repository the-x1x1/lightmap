import { describe, expect, it } from 'vitest';
import {
  buildEnvelope,
  buildEvent,
  createSentryEnvelopeReporter,
  framesFromStack,
  parseDsn,
} from '../src/sentry-envelope.ts';

describe('parseDsn', () => {
  it('derives the envelope endpoint and auth parts', () => {
    const d = parseDsn('https://abc123@o42.ingest.sentry.io/99');
    expect(d).toMatchObject({ publicKey: 'abc123', host: 'o42.ingest.sentry.io', projectId: '99' });
    expect(d.endpoint).toBe('https://o42.ingest.sentry.io/api/99/envelope/');
  });
  it('supports self-hosted DSNs with a path prefix', () => {
    expect(parseDsn('https://k@errors.example.com/sentry/7').endpoint).toBe(
      'https://errors.example.com/sentry/api/7/envelope/',
    );
  });
  it('rejects malformed DSNs', () => {
    expect(() => parseDsn('https://host/1')).toThrow();
    expect(() => parseDsn('https://k@host/notanumber')).toThrow();
  });
});

describe('buildEvent / buildEnvelope', () => {
  it('captures an Error with type, message, frames and redacted context', () => {
    const err = new TypeError('boom');
    const ev = buildEvent(
      err,
      { eventId: 'evt_1', apiKey: 'sk_live_secret', email: 'a@b.c' },
      {
        release: '0.1.0',
        environment: 'production',
        now: new Date('2026-09-24T00:00:00Z'),
        eventId: 'e'.repeat(32),
      },
    );
    expect(ev.exception?.values[0]).toMatchObject({ type: 'TypeError', value: 'boom' });
    expect(ev.exception?.values[0]?.stacktrace?.frames.length).toBeGreaterThan(0);
    expect(ev.extra).toMatchObject({ eventId: 'evt_1' });
    expect(JSON.stringify(ev.extra)).not.toContain('sk_live_secret');
    expect(JSON.stringify(ev.extra)).not.toContain('a@b.c');
    expect(ev.release).toBe('0.1.0');
    const env = buildEnvelope(
      ev,
      parseDsn('https://k@h.example/1'),
      new Date('2026-09-24T00:00:01Z'),
    );
    const lines = env.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event_id: 'e'.repeat(32),
      dsn: 'https://k@h.example/1',
    });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      type: 'event',
      length: new TextEncoder().encode(lines[2]).length,
    });
  });
  it('captures non-Error values as a message', () => {
    const ev = buildEvent('plain string', undefined, { now: new Date(), eventId: 'x' });
    expect(ev.message).toBe('plain string');
    expect(ev.exception).toBeUndefined();
  });
  it('parses V8 stacks innermost-last', () => {
    const frames = framesFromStack(
      'Error: x\n    at inner (/app/a.ts:10:5)\n    at outer (/app/b.ts:20:7)\n    at /app/c.ts:30:9',
    );
    expect(frames.map((f) => f.function)).toEqual(['<anonymous>', 'outer', 'inner']);
    expect(frames[2]).toMatchObject({ filename: '/app/a.ts', lineno: 10, colno: 5 });
  });
});

describe('createSentryEnvelopeReporter', () => {
  it('POSTs an envelope with the Sentry auth header and never throws on transport failure', async () => {
    const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      calls.push({
        url: u,
        body: typeof init?.body === 'string' ? init.body : '',
        headers: (init?.headers as Record<string, string> | undefined) ?? {},
      });
      return Promise.resolve(new Response('', { status: 200 }));
    }) as typeof fetch;
    const r = createSentryEnvelopeReporter({
      dsn: 'https://key@o1.ingest.sentry.io/5',
      release: 'lightmap@0.1.0',
      environment: 'test',
      tags: { service: 'web' },
      fetchImpl,
      now: () => new Date('2026-09-24T00:00:00Z'),
      eventId: () => 'a'.repeat(32),
    });
    r.capture(new Error('nope'), { route: '/api/x' });
    await new Promise((res) => setTimeout(res, 0));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://o1.ingest.sentry.io/api/5/envelope/');
    expect(calls[0]!.headers['X-Sentry-Auth']).toContain('sentry_key=key');
    expect(calls[0]!.body).toContain('"tags":{"service":"web"}');
    const failing = createSentryEnvelopeReporter({
      dsn: 'https://key@o1.ingest.sentry.io/5',
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    expect(() => {
      failing.capture(new Error('x'));
    }).not.toThrow();
    await new Promise((res) => setTimeout(res, 0));
  });
});

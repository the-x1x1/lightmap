/**
 * Dependency-free error reporter speaking Sentry's envelope protocol, so production gets real
 * error monitoring (Sentry, GlitchTip, Bugsink — anything DSN-compatible) without adding an SDK
 * and its transitive licence surface. Only what the plan needs (§13 "error monitoring"):
 * one event per capture with message, exception type/value, a best-effort stack, release,
 * environment and tags; metadata passes through `redact()` so secrets and PII never leave.
 *
 * Envelope format: three newline-separated JSON lines (envelope header, item header, event).
 * Auth: `X-Sentry-Auth` built from the DSN's public key. Failures are swallowed into the logger —
 * error reporting must never take the request down with it.
 */
import { redact, type ErrorReporter, type Logger } from './index.ts';

export interface SentryEnvelopeOptions {
  dsn: string;
  release?: string;
  environment?: string;
  /** Extra tags on every event (e.g. service: 'web'). */
  tags?: Record<string, string>;
  fetchImpl?: typeof fetch;
  log?: Logger;
  /** Injected for tests. */
  now?: () => Date;
  /** Injected for tests. */
  eventId?: () => string;
}

export interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
  protocol: string;
  /** Envelope endpoint URL. */
  endpoint: string;
  /** The DSN as configured (self-hosted path prefixes included), echoed in the envelope header. */
  raw: string;
}

/** `https://<key>@o123.ingest.sentry.io/456` → endpoint + auth parts. Throws on a malformed DSN. */
export function parseDsn(dsn: string): ParsedDsn {
  const u = new URL(dsn);
  const projectId = u.pathname.replace(/^\/+/, '').split('/').pop() ?? '';
  if (!u.username || !projectId || !/^\d+$/.test(projectId))
    throw new Error('SENTRY_DSN is not a valid DSN (expected protocol://key@host/projectId)');
  const basePath = u.pathname.replace(/^\/+/, '').split('/').slice(0, -1).join('/');
  const endpoint = `${u.protocol}//${u.host}/${basePath ? `${basePath}/` : ''}api/${projectId}/envelope/`;
  return {
    publicKey: u.username,
    host: u.host,
    projectId,
    protocol: u.protocol,
    endpoint,
    raw: dsn,
  };
}

function hex32(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Parse a V8 stack into Sentry frames (innermost last, as Sentry expects). Best effort. */
export function framesFromStack(stack: string | undefined): Array<{
  function: string;
  filename: string;
  lineno?: number;
  colno?: number;
}> {
  if (!stack) return [];
  const frames: Array<{ function: string; filename: string; lineno?: number; colno?: number }> = [];
  for (const line of stack.split('\n').slice(1)) {
    const m = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    frames.push({
      function: m[1] ?? '<anonymous>',
      filename: m[2] ?? '',
      lineno: Number(m[3]),
      colno: Number(m[4]),
    });
  }
  return frames.reverse().slice(-50);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export interface SentryEvent {
  event_id: string;
  timestamp: string;
  platform: 'node' | 'javascript';
  level: 'error';
  release?: string;
  environment?: string;
  message?: string;
  exception?: {
    values: Array<{ type: string; value: string; stacktrace?: { frames: unknown[] } }>;
  };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export function buildEvent(
  error: unknown,
  context: Record<string, unknown> | undefined,
  opts: Pick<SentryEnvelopeOptions, 'release' | 'environment' | 'tags'> & {
    now: Date;
    eventId: string;
  },
): SentryEvent {
  const ev: SentryEvent = {
    event_id: opts.eventId,
    timestamp: opts.now.toISOString(),
    platform: 'node',
    level: 'error',
    ...(opts.release ? { release: opts.release } : {}),
    ...(opts.environment ? { environment: opts.environment } : {}),
    ...(opts.tags ? { tags: opts.tags } : {}),
  };
  if (error instanceof Error) {
    const frames = framesFromStack(error.stack);
    ev.exception = {
      values: [
        {
          type: error.name || 'Error',
          value: error.message,
          ...(frames.length ? { stacktrace: { frames } } : {}),
        },
      ],
    };
  } else {
    ev.message = typeof error === 'string' ? error : safeStringify(error).slice(0, 1000);
  }
  if (context && Object.keys(context).length) ev.extra = redact(context);
  return ev;
}

export function buildEnvelope(event: SentryEvent, dsn: ParsedDsn, sentAt: Date): string {
  const header = JSON.stringify({
    event_id: event.event_id,
    sent_at: sentAt.toISOString(),
    dsn: dsn.raw,
  });
  const body = JSON.stringify(event);
  const item = JSON.stringify({ type: 'event', length: new TextEncoder().encode(body).length });
  return `${header}\n${item}\n${body}\n`;
}

export function createSentryEnvelopeReporter(opts: SentryEnvelopeOptions): ErrorReporter {
  const dsn = parseDsn(opts.dsn);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const eventId = opts.eventId ?? hex32;
  const auth = `Sentry sentry_version=7, sentry_client=lightmap-envelope/1, sentry_key=${dsn.publicKey}`;
  return {
    capture(error, context) {
      // Reporting must never take the request down with it: everything here is guarded, and the
      // returned promise never rejects.
      try {
        opts.log?.error('unhandled error', { error, ...(context ?? {}) });
        const at = now();
        const event = buildEvent(error, context, {
          ...(opts.release ? { release: opts.release } : {}),
          ...(opts.environment ? { environment: opts.environment } : {}),
          ...(opts.tags ? { tags: opts.tags } : {}),
          now: at,
          eventId: eventId(),
        });
        return fetchImpl(dsn.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': auth },
          body: buildEnvelope(event, dsn, at),
        })
          .then((res) => {
            if (!res.ok) opts.log?.warn('error report rejected', { status: res.status });
          })
          .catch((e: unknown) => opts.log?.warn('error report failed', { error: String(e) }));
      } catch (e) {
        opts.log?.warn('error report failed', { error: String(e) });
        return Promise.resolve();
      }
    },
  };
}

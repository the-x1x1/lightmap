import 'server-only';
import { NextResponse, after } from 'next/server';
import { NotFoundError } from '@lightmap/database';
import type { EntitlementDecision } from '@lightmap/entitlements';
import { getServices } from './services.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function json<T>(body: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, init);
}

/**
 * Report an error without holding the response back. On serverless hosts the function is frozen
 * once the response is sent, so the report is handed to Next's `after()` to keep the invocation
 * alive until it has been delivered; outside a request scope (unit tests, scripts) it just runs.
 */
export function reportError(error: unknown, context: Record<string, unknown>): void {
  const done = getServices().errors.capture(error, context);
  try {
    after(done);
  } catch {
    // Not inside a request: nothing to keep alive.
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...error.extra } },
      { status: error.status },
    );
  if (error instanceof NotFoundError)
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found' } },
      { status: 404 },
    );
  // The reporter logs (and forwards to the DSN when configured); nothing else touches the error.
  reportError(error, { where: 'api' });
  return NextResponse.json(
    {
      error: {
        code: 'internal',
        message: 'Something went wrong on our side. Your selection is unchanged.',
      },
    },
    { status: 500 },
  );
}

export function forbidByEntitlement(d: EntitlementDecision): HttpError {
  return new HttpError(
    403,
    `entitlement_${d.key}`,
    d.reason ?? 'Not available on your plan',
    d.upgradeTo ? { upgradeTo: d.upgradeTo } : {},
  );
}

/** Parse and validate a query number within bounds. */
export function num(params: URLSearchParams, key: string, min: number, max: number): number {
  const raw = params.get(key);
  const v = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(v) || v < min || v > max)
    throw new HttpError(400, 'bad_request', `${key} must be a number between ${min} and ${max}`);
  return v;
}

export function str(
  params: URLSearchParams,
  key: string,
  opts: { maxLength?: number; required?: boolean; pattern?: RegExp } = {},
): string | null {
  const v = params.get(key);
  if (v === null || v.length === 0) {
    if (opts.required) throw new HttpError(400, 'bad_request', `${key} is required`);
    return null;
  }
  if (v.length > (opts.maxLength ?? 200))
    throw new HttpError(400, 'bad_request', `${key} is too long`);
  if (opts.pattern && !opts.pattern.test(v))
    throw new HttpError(400, 'bad_request', `${key} is malformed`);
  return v;
}

/**
 * CSRF defence in depth (plan §29): cookie-authenticated mutations must come from our own origin.
 * Auth.js protects its own routes; this covers the JSON API. Browsers always send Sec-Fetch-Site
 * (and Origin on POST/PATCH/DELETE); a request with neither is a non-browser client and is allowed
 * only when it carries no cookies.
 */
export function requireSameOrigin(req: Request): void {
  const site = req.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return;
  const origin = req.headers.get('origin');
  const appOrigin = new URL(getServices().env.NEXT_PUBLIC_APP_URL).origin;
  if (origin) {
    if (origin === appOrigin) return;
    throw new HttpError(403, 'cross_origin', 'Cross-origin requests are not allowed.');
  }
  if (site) throw new HttpError(403, 'cross_origin', 'Cross-origin requests are not allowed.');
  if (req.headers.get('cookie')) throw new HttpError(403, 'cross_origin', 'Missing Origin header.');
}

export async function readJson<T>(req: Request, validate: (v: unknown) => T): Promise<T> {
  requireSameOrigin(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'bad_request', 'Body must be JSON');
  }
  try {
    return validate(body);
  } catch (e) {
    throw new HttpError(400, 'bad_request', e instanceof Error ? e.message : 'Invalid body');
  }
}

/** Tiny validators without a schema library (kept dependency-light on purpose). */
export const v = {
  obj(x: unknown): Record<string, unknown> {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('expected an object');
    return x as Record<string, unknown>;
  },
  string(
    x: unknown,
    name: string,
    opts: { min?: number; max?: number; optional?: boolean; nullable?: boolean } = {},
  ): string | null | undefined {
    if (x === undefined && opts.optional) return undefined;
    if (x === null && opts.nullable) return null;
    if (typeof x !== 'string') throw new Error(`${name} must be a string`);
    const t = x.trim();
    if (t.length < (opts.min ?? 0)) throw new Error(`${name} is too short`);
    if (t.length > (opts.max ?? 500)) throw new Error(`${name} is too long`);
    return t;
  },
  number(
    x: unknown,
    name: string,
    min: number,
    max: number,
    opts: { optional?: boolean; nullable?: boolean } = {},
  ): number | null | undefined {
    if (x === undefined && opts.optional) return undefined;
    if (x === null && opts.nullable) return null;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max)
      throw new Error(`${name} must be a number between ${min} and ${max}`);
    return x;
  },
  oneOf<T extends string>(
    x: unknown,
    name: string,
    allowed: readonly T[],
    opts: { optional?: boolean; nullable?: boolean } = {},
  ): T | null | undefined {
    if (x === undefined && opts.optional) return undefined;
    if (x === null && opts.nullable) return null;
    if (typeof x !== 'string' || !(allowed as readonly string[]).includes(x))
      throw new Error(`${name} must be one of ${allowed.join(', ')}`);
    return x as T;
  },
  isoDate(
    x: unknown,
    name: string,
    opts: { optional?: boolean; nullable?: boolean } = {},
  ): string | null | undefined {
    const s = v.string(x, name, { ...opts, max: 10 });
    if (s === null || s === undefined) return s;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)))
      throw new Error(`${name} must be YYYY-MM-DD`);
    return s;
  },
  instant(x: unknown, name: string): Date {
    if (typeof x !== 'string' || Number.isNaN(Date.parse(x)))
      throw new Error(`${name} must be an ISO instant`);
    return new Date(x);
  },
};

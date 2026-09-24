'use client';
import type { ApiError } from '@/lib/api-types';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly upgradeTo: string | undefined;
  constructor(status: number, body: ApiError['error']) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.upgradeTo = body.upgradeTo;
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: ApiError['error'] = { code: 'http_error', message: `Request failed (${res.status})` };
    try {
      const parsed = (await res.json()) as Partial<ApiError>;
      if (parsed.error) body = parsed.error;
    } catch {
      /* non-JSON error */
    }
    throw new ApiRequestError(res.status, body);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => fetchJson<T>(url),
  post: <T>(url: string, body: unknown) =>
    fetchJson<T>(url, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    fetchJson<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(url: string) => fetchJson<T>(url, { method: 'DELETE' }),
};

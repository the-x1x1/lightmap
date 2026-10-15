import 'server-only';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { HttpError, errorResponse, requireSameOrigin } from './http.ts';
import { getServices } from './services.ts';

/**
 * The desktop apps' accounts (docs/SECURITY_MODEL.md "Desktop sign-in"). A desktop app runs this
 * server on 127.0.0.1 with no database; with LIGHTMAP_ACCOUNT_ORIGIN set, its account, project,
 * viewpoint and billing routes forward each request to the hosted LightMap with the device token
 * the browser sign-in gave it, so the app sees the same account, plan and projects as the web.
 *
 * The token is kept in the app's data folder (LIGHTMAP_DATA_DIR/account.json, readable by its
 * user only) and never reaches the page. Requests reach the hosted server without the page's
 * cookies or Origin. The local server takes only requests addressed to itself by its own name
 * (a page on another site that rebinds a hostname to 127.0.0.1 is refused) and only same-origin
 * changes.
 */

interface SavedSignIn {
  token: string;
  savedAt: string;
}

/** Without a data folder (a plain `next start`), the sign-in lasts as long as the process. */
let memory: SavedSignIn | null = null;

export function accountOrigin(): string | null {
  return getServices().env.LIGHTMAP_ACCOUNT_ORIGIN ?? null;
}

function signInFile(): string | null {
  const dir = getServices().env.LIGHTMAP_DATA_DIR;
  return dir ? join(dir, 'account.json') : null;
}

export async function readSignIn(): Promise<SavedSignIn | null> {
  const file = signInFile();
  if (!file) return memory;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<SavedSignIn>;
    return typeof parsed.token === 'string'
      ? { token: parsed.token, savedAt: parsed.savedAt ?? '' }
      : null;
  } catch {
    return null;
  }
}

export async function saveSignIn(token: string): Promise<void> {
  const saved = { token, savedAt: new Date().toISOString() };
  const file = signInFile();
  if (!file) {
    memory = saved;
    return;
  }
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(saved), { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600).catch(() => undefined); // an existing file keeps its old mode otherwise
}

export async function clearSignIn(): Promise<void> {
  memory = null;
  const file = signInFile();
  if (file) await rm(file, { force: true }).catch(() => undefined);
}

/** Refuses a request that did not address this server by its own host (DNS rebinding). */
export function requireOwnHost(req: Request): void {
  const own = new URL(getServices().env.NEXT_PUBLIC_APP_URL).host;
  const host = req.headers.get('host');
  if (host && host !== own)
    throw new HttpError(403, 'wrong_host', 'This app answers only at its own address.');
}

/** A request to the hosted server from this one: JSON, the device token, nothing of the page's. */
export async function callAccountOrigin(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<Response> {
  const origin = accountOrigin();
  if (!origin) throw new HttpError(404, 'not_found', 'Not found');
  const headers = new Headers({
    accept: 'application/json',
    'user-agent': 'LightMap-desktop',
  });
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  try {
    return await fetch(origin + path, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(
      503,
      'account_unreachable',
      "LightMap's account service could not be reached. Check the internet connection and try again.",
    );
  }
}

/**
 * Forwards this request to the hosted LightMap when this is a desktop app (LIGHTMAP_ACCOUNT_ORIGIN
 * set); null when this server keeps its own accounts and the route should answer itself.
 */
export async function forwardToAccountOrigin(req: Request): Promise<Response | null> {
  const origin = accountOrigin();
  if (!origin) return null;
  try {
    requireOwnHost(req);
    if (req.method !== 'GET' && req.method !== 'HEAD') requireSameOrigin(req);
    const url = new URL(req.url);
    const saved = await readSignIn();
    const headers = new Headers({ accept: 'application/json' });
    const type = req.headers.get('content-type');
    if (type) headers.set('content-type', type);
    if (saved) headers.set('authorization', `Bearer ${saved.token}`);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let res: Response;
    try {
      res = await fetch(origin + url.pathname + url.search, {
        method: req.method,
        headers,
        ...(hasBody ? { body: await req.arrayBuffer() } : {}),
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new HttpError(
        503,
        'account_unreachable',
        "LightMap's account service could not be reached. Check the internet connection and try again.",
      );
    }
    // A token revoked from the website (or with the account) is no sign-in here either.
    if (res.status === 401 && saved) await clearSignIn();
    const out = new Headers({ 'cache-control': 'private, no-store' });
    const resType = res.headers.get('content-type');
    if (resType) out.set('content-type', resType);
    return new NextResponse(await res.arrayBuffer(), { status: res.status, headers: out });
  } catch (e) {
    return errorResponse(e);
  }
}

import { hostname } from 'node:os';
import { HttpError, errorResponse, json, requireSameOrigin } from '@/lib/server/http';
import {
  accountOrigin,
  callAccountOrigin,
  clearSignIn,
  readSignIn,
  requireOwnHost,
  saveSignIn,
} from '@/lib/server/account-proxy';

export const dynamic = 'force-dynamic';

/**
 * A desktop app's own sign-in (only with LIGHTMAP_ACCOUNT_ORIGIN): POST starts it (the hosted
 * server's code and page, which the app opens in the browser), GET reports it and polls the
 * hosted server while it waits, DELETE signs this device out. The poll secret and the token stay
 * in this process and its data folder; the page sees the code and whether it worked.
 */
let pending: { pollSecret: string; code: string; verifyUrl: string; expiresAt: number } | null =
  null;

function requireDesktop(req: Request): void {
  if (!accountOrigin()) throw new HttpError(404, 'not_found', 'Not found');
  requireOwnHost(req);
}

export async function POST(req: Request) {
  try {
    requireDesktop(req);
    requireSameOrigin(req);
    const res = await callAccountOrigin('/api/desktop/link', {
      method: 'POST',
      body: { deviceName: hostname() },
    });
    if (res.status !== 201)
      throw new HttpError(
        502,
        'link_failed',
        'The account service did not start the sign-in. Try again in a moment.',
      );
    const link = (await res.json()) as {
      code: string;
      pollSecret: string;
      verifyUrl: string;
      expiresIn: number;
    };
    pending = {
      pollSecret: link.pollSecret,
      code: link.code,
      verifyUrl: link.verifyUrl,
      expiresAt: Date.now() + link.expiresIn * 1000,
    };
    return json({ code: link.code, verifyUrl: link.verifyUrl });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request) {
  try {
    requireDesktop(req);
    if (await readSignIn()) return json({ signedIn: true });
    if (!pending) return json({ signedIn: false });
    if (pending.expiresAt <= Date.now()) {
      pending = null;
      return json({ signedIn: false, expired: true });
    }
    const res = await callAccountOrigin('/api/desktop/link/poll', {
      method: 'POST',
      body: { pollSecret: pending.pollSecret },
    });
    if (res.status === 200) {
      const body = (await res.json()) as { token?: string };
      if (body.token) {
        await saveSignIn(body.token);
        pending = null;
        return json({ signedIn: true });
      }
    }
    if (res.status === 410) {
      pending = null;
      return json({ signedIn: false, expired: true });
    }
    return json(
      { signedIn: false, waiting: { code: pending.code, verifyUrl: pending.verifyUrl } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    requireDesktop(req);
    requireSameOrigin(req);
    const saved = await readSignIn();
    pending = null;
    if (saved)
      await callAccountOrigin('/api/desktop/token', { method: 'DELETE', token: saved.token }).catch(
        () => undefined, // offline: the token is forgotten here; the website can revoke it later
      );
    await clearSignIn();
    return json({ signedIn: false });
  } catch (e) {
    return errorResponse(e);
  }
}

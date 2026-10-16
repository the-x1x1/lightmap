import { devicesRepo } from '@lightmap/database';
import { HttpError, errorResponse, json, readJson } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';
import { checkBurst, clientKey } from '@/lib/server/rate-limit';
import { requireBrowserUser, requireDb } from '@/lib/server/session';
import {
  LINK_TTL_MS,
  POLL_INTERVAL_S,
  cleanDeviceName,
  newLinkCode,
  networkKey,
  newSecret,
  sameNetwork,
  normaliseLinkCode,
  sha256,
} from '@/lib/server/device-auth';

export const dynamic = 'force-dynamic';

/**
 * A desktop app starts its sign-in (docs/SECURITY_MODEL.md "Desktop sign-in"): it gets a code to
 * show and a page to open, and keeps the poll secret. Nothing is granted until the code is
 * approved by a signed-in person on that page, and the link lapses after ten minutes.
 */
export async function POST(req: Request) {
  try {
    checkBurst(`desktop-link:${clientKey(req, null)}`, 10);
    const db = requireDb();
    const { deviceName } = await readJson(req, (b) => ({
      deviceName: cleanDeviceName((b as Record<string, unknown> | null)?.['deviceName']),
    }));
    const pollSecret = newSecret();
    // A code collision is astronomically rare; one retry covers it.
    let code = newLinkCode();
    if (await devicesRepo(db).linkByCode(code)) code = newLinkCode();
    await devicesRepo(db).createLink({
      code,
      pollHash: sha256(pollSecret),
      deviceName,
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
      requestNet: networkKey(req, getServices().env.AUTH_SECRET ?? 'lightmap-anon'),
    });
    const base = getServices().env.NEXT_PUBLIC_APP_URL;
    return json(
      {
        code,
        pollSecret,
        verifyUrl: `${base}/link?code=${encodeURIComponent(code)}`,
        expiresIn: LINK_TTL_MS / 1000,
        interval: POLL_INTERVAL_S,
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/** The link page asks what it is approving: the device's name and whether it can still be. */
export async function GET(req: Request) {
  try {
    await requireBrowserUser();
    const code = normaliseLinkCode(new URL(req.url).searchParams.get('code') ?? '');
    if (!code) throw new HttpError(400, 'bad_code', 'That code does not look right.');
    const link = await devicesRepo(requireDb()).linkByCode(code);
    if (!link) throw new HttpError(404, 'not_found', 'No sign-in is waiting for that code.');
    const expired = link.expiresAt.getTime() <= Date.now();
    // Phishing context: whether this browser is on the network the app asked from, and how long
    // ago the app asked.
    const here = networkKey(req, getServices().env.AUTH_SECRET ?? 'lightmap-anon');
    return json(
      {
        code,
        deviceName: link.deviceName,
        state: link.approvedAt ? 'approved' : expired ? 'expired' : 'waiting',
        sameNetwork: sameNetwork(link.requestNet, here),
        ageSeconds: Math.max(0, Math.round((Date.now() - link.createdAt.getTime()) / 1000)),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

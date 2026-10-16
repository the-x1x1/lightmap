import { createHash, randomBytes } from 'node:crypto';

/**
 * Desktop sign-in (migration 0006, docs/SECURITY_MODEL.md): the codes, secrets and tokens, and
 * how they are stored. Only sha-256 hashes reach the database; the poll secret and the token are
 * 32 random bytes each, so a hash without a salt is enough (nothing to guess from).
 */

/** Device tokens start with this, so one in a log or a paste is recognisable and revocable. */
export const DEVICE_TOKEN_PREFIX = 'lmd_';
/** How long a link waits for its approval. */
export const LINK_TTL_MS = 10 * 60_000;
/** How often an app should poll, seconds. */
export const POLL_INTERVAL_S = 3;

/** Letters and digits a person cannot misread for one another (no 0/O, 1/I/L, U/V). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The code shown in the app and on the website, `ABCD-EFGH`. */
export function newLinkCode(random: (n: number) => Buffer = randomBytes): string {
  const bytes = random(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalises what a person typed or a link carried: upper case, the dash where it belongs. */
export function normaliseLinkCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 8 || [...s].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function newSecret(prefix = ''): string {
  return prefix + randomBytes(32).toString('base64url');
}

/** The bearer token in an Authorization header, when it is a device token. */
export function bearerDeviceToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  const token = m?.[1];
  return token && token.startsWith(DEVICE_TOKEN_PREFIX) && token.length > 20 ? token : null;
}

/** A device's name as the person will see it in their account: printable, at most 60 characters. */
export function cleanDeviceName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} ._'()-]/gu, '').trim() : '';
  return (s || 'LightMap desktop').slice(0, 60);
}

/**
 * A keyed hash of the network a request comes from: the IPv4 /24 or the IPv6 /48 of its client
 * address (the first forwarded hop), never the address itself. Two requests from one home or
 * office share it; the app and the browser it opens on the same computer always do. Null when
 * the address is unknown.
 */
export function networkKey(req: Request, salt: string): string | null {
  const ip = (
    req.headers.get('x-forwarded-for')?.split(',')[0] ??
    req.headers.get('x-real-ip') ??
    ''
  ).trim();
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  let prefix: string;
  if (v4) prefix = `4:${v4[1]}.${v4[2]}.${v4[3]}`;
  else if (ip.includes(':')) prefix = `6:${ip.toLowerCase().split(':').slice(0, 3).join(':')}`;
  else return null;
  return sha256(`${salt}|net|${prefix}`).slice(0, 32);
}

/**
 * Whether an approving browser is on the network the app asked from. Both unknown (no proxy in
 * front, as on a computer serving itself) counts as the same; one known and one not does not.
 */
export function sameNetwork(requested: string | null | undefined, here: string | null): boolean {
  return (requested ?? null) === here;
}

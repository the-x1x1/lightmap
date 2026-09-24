/**
 * ULIDs: sortable, URL-safe, unguessable — and NOT authorization (plan §29). Every repository
 * method takes the acting user's id and filters by it.
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(
  now: number = Date.now(),
  random: (n: number) => Uint8Array = randomBytes,
): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ENCODING[bytes[i]! % 32];
  return time + rand;
}

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  globalThis.crypto.getRandomValues(arr);
  return arr;
}

export function isUlid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(v);
}

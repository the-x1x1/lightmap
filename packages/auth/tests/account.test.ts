import { describe, expect, it } from 'vitest';
import { magicLinkEmail, normalizeEmail } from '../src/account.ts';

describe('account helpers', () => {
  it('normalises emails and rejects junk', () => {
    expect(normalizeEmail('  Chris@Example.COM ')).toBe('chris@example.com');
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
  });
  it('magic link email is plain text with the url and expiry', () => {
    const m = magicLinkEmail({ productName: 'LightMap', url: 'https://x/verify?t=1', host: 'x', expiresMinutes: 15 });
    expect(m.subject).toBe('Sign in to LightMap');
    expect(m.text).toContain('https://x/verify?t=1');
    expect(m.text).toContain('15 minutes');
  });
});

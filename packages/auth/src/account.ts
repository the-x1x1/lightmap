/**
 * Account service (plan §16): the interface the app depends on. Auth.js is an implementation
 * detail behind it, so a hosted auth vendor could replace it without touching routes or UI.
 */
export interface AccountIdentity {
  userId: string;
  email: string;
  displayName: string | null;
  image: string | null;
}

export interface AccountService {
  /** The signed-in user for the current request, or null. */
  current(): Promise<AccountIdentity | null>;
  /** Marks the account for deletion; a scheduled job erases data after the retention window (docs/PRIVACY.md). */
  requestDeletion(userId: string): Promise<void>;
  /** Available sign-in methods for the UI. */
  methods(): { email: boolean; google: boolean; devLogin: boolean };
}

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 3600;

/** Magic-link email body. Plain text on purpose: fewer spam signals, nothing to render. */
export function magicLinkEmail(opts: {
  productName: string;
  url: string;
  host: string;
  expiresMinutes: number;
}): { subject: string; text: string } {
  return {
    subject: `Sign in to ${opts.productName}`,
    text: [
      `Sign in to ${opts.productName} on ${opts.host}:`,
      '',
      opts.url,
      '',
      `This link expires in ${opts.expiresMinutes} minutes and can be used once.`,
      `If you did not request it, you can ignore this email.`,
    ].join('\n'),
  };
}

/** Normalise an email for lookup: lowercase, trimmed. Dev sign-in accepts anything that looks like an address. */
export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

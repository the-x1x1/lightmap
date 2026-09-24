import NextAuth from 'next-auth';
import { buildAuthConfig } from '@lightmap/auth/config';
import { getServices } from '@/lib/server/services';

/**
 * Auth.js entry point. When there is no database, auth is disabled and `auth()` returns null —
 * anonymous exploration still works (plan §16 "browse a limited demo without an account").
 */
const services = getServices();

const disabled = {
  handlers: {
    GET: async () =>
      new Response(
        JSON.stringify({
          error: { code: 'auth_disabled', message: 'Accounts need a database (DATABASE_URL).' },
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    POST: async () =>
      new Response(
        JSON.stringify({
          error: { code: 'auth_disabled', message: 'Accounts need a database (DATABASE_URL).' },
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
  },
  auth: async () => null,
  signIn: async () => {
    throw new Error('auth disabled');
  },
  signOut: async () => {
    throw new Error('auth disabled');
  },
};

const nextAuth =
  services.db && services.env.AUTH_SECRET
    ? NextAuth(
        buildAuthConfig({
          env: services.env,
          db: services.db.db,
          log: (level, message, meta) => services.log[level](message, meta),
        }),
      )
    : null;

export const handlers = nextAuth?.handlers ?? disabled.handlers;
export const auth: () => Promise<{
  user?: { id?: string; email?: string | null; name?: string | null; image?: string | null };
} | null> = nextAuth ? (nextAuth.auth as unknown as typeof auth) : disabled.auth;
export const signIn = nextAuth?.signIn ?? disabled.signIn;
export const signOut = nextAuth?.signOut ?? disabled.signOut;

/**
 * Auth.js v5 configuration for the Next.js app. Only imported from apps/web/auth.ts (server).
 *
 *  - Email magic links (Nodemailer). With no EMAIL_SERVER in development the link is printed to
 *    the server log instead of being sent — the honest dev mode (plan §33).
 *  - Google, when configured.
 *  - Dev sign-in (Credentials, any email, no link): only when AUTH_DEV_LOGIN=true and not
 *    production. Env validation refuses it in production; this file checks again.
 *  - Database sessions (revocable), secure cookies, 30-day expiry with daily refresh.
 */
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import Nodemailer from 'next-auth/providers/nodemailer';
import { createTransport } from 'nodemailer';
import { brand, type Env } from '@lightmap/config';
import { schema, ulid, type Db } from '@lightmap/database';
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  magicLinkEmail,
  normalizeEmail,
} from './account.ts';

export interface AuthConfigDeps {
  env: Env;
  db: Db;
  log: (level: 'info' | 'warn', message: string, meta?: Record<string, unknown>) => void;
}

export function buildAuthConfig({ env, db, log }: AuthConfigDeps): NextAuthConfig {
  const isProd = env.NODE_ENV === 'production';
  type Provider = NextAuthConfig['providers'][number];
  const providers: Provider[] = [];

  providers.push(
    // Auth.js's own NodemailerConfig is not assignable to its Provider union under
    // exactOptionalPropertyTypes (EmailConfig.server is typed `NodemailerConfig["server"]`, which
    // includes `undefined`). The assertion only bridges that inconsistency in their .d.ts.
    Nodemailer({
      server: env.EMAIL_SERVER ?? { host: 'localhost', port: 25 },
      from: env.EMAIL_FROM,
      maxAge: 15 * 60,
      async sendVerificationRequest({ identifier, url, provider }) {
        const { host } = new URL(url);
        const mail = magicLinkEmail({ productName: brand.name, url, host, expiresMinutes: 15 });
        if (!env.EMAIL_SERVER) {
          if (isProd) throw new Error('EMAIL_SERVER is not configured');
          log('info', `[dev] magic link for ${identifier}: ${url}`);
          return;
        }
        const transport = createTransport(provider.server);
        await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: mail.subject,
          text: mail.text,
        });
      },
    }) as Provider,
  );

  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        allowDangerousEmailAccountLinking: false,
      }),
    );
  }

  const devLogin = env.AUTH_DEV_LOGIN && !isProd;
  if (devLogin) {
    providers.push(
      Credentials({
        id: 'dev-login',
        name: 'Dev sign-in',
        credentials: { email: { label: 'Email', type: 'email' } },
        async authorize(credentials) {
          const email = normalizeEmail(String(credentials?.['email'] ?? ''));
          if (!email) return null;
          // Find or create the user directly; Credentials providers bypass the adapter.
          const existing = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.email, email),
          });
          if (existing)
            return {
              id: existing.id,
              email: existing.email,
              name: existing.name,
              image: existing.image,
            };
          const id = ulid();
          await db.insert(schema.users).values({
            id,
            email,
            emailVerified: new Date(),
            name: email.split('@')[0] ?? null,
          });
          log('warn', `[dev] created user ${email} via dev sign-in`);
          return { id, email, name: email.split('@')[0] ?? null, image: null };
        },
      }),
    );
  }

  return {
    adapter: DrizzleAdapter(db, {
      usersTable: schema.users as never,
      accountsTable: schema.accounts as never,
      sessionsTable: schema.sessions as never,
      verificationTokensTable: schema.verificationTokens as never,
    }),
    providers,
    // Credentials providers require JWT sessions in Auth.js; database sessions for everything else.
    session: {
      strategy: devLogin ? 'jwt' : 'database',
      maxAge: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    // Auth.js falls back to the AUTH_SECRET env var itself; only pass it when validated env has it.
    ...(env.AUTH_SECRET ? { secret: env.AUTH_SECRET } : {}),
    trustHost: true,
    useSecureCookies: isProd,
    pages: {
      signIn: '/account/sign-in',
      verifyRequest: '/account/check-email',
      error: '/account/error',
    },
    callbacks: {
      async jwt({ token, user }) {
        if (user?.id) token['uid'] = user.id;
        return token;
      },
      async session({ session, user, token }) {
        const id = user?.id ?? (token?.['uid'] as string | undefined);
        if (id) (session.user as { id?: string }).id = id;
        return session;
      },
    },
    events: {
      async createUser({ user }) {
        if (user.id)
          await db.insert(schema.profiles).values({ userId: user.id }).onConflictDoNothing();
      },
      // Signing in cancels a pending deletion request (docs/PRIVACY.md: 14-day reversible window).
      async signIn({ user }) {
        if (user?.id)
          await db
            .update(schema.users)
            .set({ deletionRequestedAt: null, updatedAt: new Date() })
            .where(eq(schema.users.id, user.id));
      },
    },
    logger: {
      error: (error) => log('warn', 'auth error', { error: String(error) }),
      warn: (code) => log('warn', `auth warning ${code}`),
    },
  };
}

export function authMethods(env: Env): { email: boolean; google: boolean; devLogin: boolean } {
  return {
    email: env.EMAIL_SERVER !== undefined || env.NODE_ENV !== 'production',
    google: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
    devLogin: env.AUTH_DEV_LOGIN && env.NODE_ENV !== 'production',
  };
}

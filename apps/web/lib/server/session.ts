import 'server-only';
import { headers } from 'next/headers';
import { deriveEntitlements, type EntitlementSnapshot } from '@lightmap/entitlements';
import { devicesRepo, subscriptionsRepo, usersRepo, type Subscription } from '@lightmap/database';
import { auth } from '@/auth';
import { bearerDeviceToken, sha256 } from './device-auth.ts';
import { HttpError } from './http.ts';
import { getServices } from './services.ts';

export interface RequestUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface RequestContext {
  user: RequestUser | null;
  entitlements: EntitlementSnapshot;
  subscription: Subscription | null;
  planForBudget: 'anonymous' | 'free' | 'pro';
}

/**
 * A desktop app's request: `Authorization: Bearer lmd_…` (a device token from the browser
 * sign-in, migration 0006). Read only when there is no browser session; a revoked or unknown
 * token is no user at all.
 */
async function deviceUser(): Promise<{ id: string; email: string; name: string | null } | null> {
  const { db } = getServices();
  if (!db) return null;
  let token: string | null = null;
  try {
    token = bearerDeviceToken((await headers()).get('authorization'));
  } catch {
    return null; // outside a request
  }
  if (!token) return null;
  const owner = await devicesRepo(db.db).userForToken(sha256(token));
  if (!owner) return null;
  const user = await usersRepo(db.db).byId(owner.userId);
  return user ? { id: user.id, email: user.email, name: user.name } : null;
}

/** Resolve the signed-in user and their server-derived entitlements. Never trusts the client. */
export async function requestContext(): Promise<RequestContext> {
  const { db } = getServices();
  const session = await auth();
  const device = session?.user?.id ? null : await deviceUser();
  const id = session?.user?.id ?? device?.id;
  if (!id || !db)
    return {
      user: null,
      entitlements: deriveEntitlements(null),
      subscription: null,
      planForBudget: 'anonymous',
    };
  const subscription = await subscriptionsRepo(db.db).forUser(id);
  const entitlements = deriveEntitlements(
    subscription
      ? {
          planKey: subscription.planKey as 'free' | 'pro' | 'studio',
          status: subscription.status as never,
          periodEnd: subscription.periodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
  );
  return {
    user: device
      ? { id, email: device.email, displayName: device.name }
      : { id, email: session?.user?.email ?? '', displayName: session?.user?.name ?? null },
    entitlements,
    subscription,
    planForBudget: entitlements.effectivePlan === 'free' ? 'free' : 'pro',
  };
}

export async function requireUser(): Promise<RequestContext & { user: RequestUser }> {
  const ctx = await requestContext();
  if (!ctx.user)
    throw new HttpError(401, 'unauthenticated', 'Sign in to save projects and viewpoints.');
  return ctx as RequestContext & { user: RequestUser };
}

export function requireDb() {
  const { db } = getServices();
  if (!db)
    throw new HttpError(
      503,
      'no_database',
      'Saving is unavailable: the server has no database configured.',
    );
  return db.db;
}

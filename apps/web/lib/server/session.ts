import 'server-only';
import { deriveEntitlements, type EntitlementSnapshot } from '@lightmap/entitlements';
import { subscriptionsRepo, type Subscription } from '@lightmap/database';
import { auth } from '@/auth';
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

/** Resolve the signed-in user and their server-derived entitlements. Never trusts the client. */
export async function requestContext(): Promise<RequestContext> {
  const { db } = getServices();
  const session = await auth();
  const id = session?.user?.id;
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
    user: { id, email: session?.user?.email ?? '', displayName: session?.user?.name ?? null },
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
